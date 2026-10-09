import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, buildSessionContext } from "@earendil-works/pi-coding-agent";
import { ConversationRunner, ENTRY_TYPE, MAX_CONTEXT_CHARS, MAX_CHAT_CHARS, requestContext, restore, shareDraft, snapshot, startRecord, type Complete, type Record } from "../src/conversation.ts";

const answer = (text = "Side answer") => ({ stopReason: "stop", content: [{ type: "text", text }] });
const user = (content: string) => ({ role: "user" as const, content, timestamp: Date.now() });

function setup(complete: Complete = async () => answer()) {
  const session = SessionManager.inMemory();
  session.appendMessage(user("Main task: build the extension"));
  const original = buildSessionContext(session.getBranch()).messages;
  const chat = snapshot(session.getBranch());
  session.appendCustomEntry(ENTRY_TYPE, startRecord(chat));
  const records: Record[] = [];
  const runner = new ConversationRunner(chat, complete, record => {
    records.push(record);
    session.appendCustomEntry(ENTRY_TYPE, record);
  });
  return { session, original, chat, records, runner };
}

test("side turns persist and restore without entering main model context", async () => {
  const { session, chat, runner, original } = setup();
  await runner.ask("Why this approach?");
  await runner.ask("What about alternatives?");
  assert.deepEqual(buildSessionContext(session.getBranch()).messages, original);
  assert.deepEqual(restore(session.getBranch()), chat);
  assert.match(shareDraft(chat)!, /What about alternatives/);
});

test("context is a fixed snapshot, with previous side exchanges in follow-ups and no tools", async () => {
  const requests: ReturnType<typeof requestContext>[] = [];
  const { runner, session } = setup(async context => { requests.push(context); return answer(); });
  await runner.ask("First");
  session.appendMessage(user("Later main task"));
  await runner.ask("Second");
  const body = JSON.stringify(requests[1]);
  assert.match(body, /Main task/);
  assert.match(body, /Side answer/);
  assert.match(body, /First/);
  assert.doesNotMatch(body, /Later main task/);
  assert.equal("tools" in requests[1], false);
});

test("restore follows the active branch and a new conversation supersedes the old one", async () => {
  const { session, runner, chat } = setup();
  const forkPoint = session.getLeafId()!;
  await runner.ask("Sibling-only question");
  session.branch(forkPoint);
  assert.equal(restore(session.getBranch())!.turns.length, 0);
  const fresh = snapshot(session.getBranch());
  session.appendCustomEntry(ENTRY_TYPE, startRecord(fresh));
  assert.notEqual(fresh.id, chat.id);
  assert.equal(restore(session.getBranch())!.id, fresh.id);
});

test("snapshot respects compaction and bounds very large contexts", () => {
  const session = SessionManager.inMemory();
  session.appendMessage(user("Discarded old message"));
  const keep = session.appendMessage(user("Retained message"));
  session.appendCompaction("Earlier work summary", keep, 5000);
  const compact = snapshot(session.getBranch());
  assert.match(compact.context, /Earlier work summary/);
  assert.match(compact.context, /Retained message/);
  assert.doesNotMatch(compact.context, /Discarded old message/);
  session.appendMessage(user("x".repeat(MAX_CONTEXT_CHARS + 1) + "Newest context"));
  const limited = snapshot(session.getBranch());
  assert.equal(limited.contextTruncated, true);
  assert.equal(limited.context.length, MAX_CONTEXT_CHARS);
  assert.match(limited.context, /Newest context/);
});

test("failed and empty responses leave no orphan user turns", async () => {
  for (const result of [{ stopReason: "error", errorMessage: "rate limited", content: [] }, answer(""), { stopReason: "toolUse", content: [] }]) {
    const { runner, records, chat } = setup(async () => result);
    await assert.rejects(runner.ask("Question"));
    assert.equal(runner.busy, false);
    assert.deepEqual(records, []);
    assert.deepEqual(chat.turns, []);
  }
});

test("cancel ignores a provider's late success and allows another request immediately", async () => {
  let resolve!: (value: ReturnType<typeof answer>) => void;
  let count = 0;
  const { runner, records } = setup(async () => ++count === 1 ? new Promise(done => { resolve = done; }) : answer("New answer"));
  const first = runner.ask("Cancel me");
  assert.equal(await runner.ask("Duplicate"), false);
  runner.cancel();
  assert.equal(await runner.ask("Replacement"), true);
  resolve(answer("Stale answer"));
  assert.equal(await first, false);
  assert.equal(records.length, 1);
  assert.equal(runner.chat.turns[0].answer, "New answer");
});

test("abort rejection is handled and persistence errors do not commit", async () => {
  const { runner, chat } = setup((_context, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const request = runner.ask("Question");
  runner.cancel();
  assert.equal(await request, false);
  const failing = new ConversationRunner(chat, async () => answer(), () => { throw new Error("session changed"); });
  await assert.rejects(failing.ask("Question"), /session changed/);
  assert.equal(chat.turns.length, 0);
});

test("malformed records ignored; full chats fail before contacting the provider", async () => {
  const { session, chat, runner } = setup();
  session.appendCustomEntry(ENTRY_TYPE, { version: 1, kind: "turn", id: chat.id, question: 4 });
  session.appendCustomEntry(ENTRY_TYPE, { version: 3, kind: "start", id: "invalid" });
  assert.deepEqual(restore(session.getBranch()), chat);
  await assert.rejects(runner.ask("x".repeat(MAX_CHAT_CHARS + 1)), /full/);
  assert.equal(runner.busy, false);
});

test("saved Pi sessions restore side history from disk", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "pi-side-persistence-"));
  try {
    const session = SessionManager.create(directory, directory);
    session.appendMessage(user("Main question"));
    session.appendMessage({
      role: "assistant", content: [{ type: "text", text: "Main answer" }],
      api: "test", provider: "test", model: "test", timestamp: Date.now(), stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    const chat = snapshot(session.getBranch());
    session.appendCustomEntry(ENTRY_TYPE, startRecord(chat));
    const runner = new ConversationRunner(chat, async () => answer(), record => session.appendCustomEntry(ENTRY_TYPE, record));
    await runner.ask("Persist this question");
    const reopened = SessionManager.open(session.getSessionFile()!);
    assert.deepEqual(restore(reopened.getBranch()), chat);
    assert.equal(reopened.buildSessionContext().messages.length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
