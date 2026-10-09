import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import sideExtension from "../extensions/side.ts";
import { restore } from "../src/conversation.ts";
import { SidePanel, type PanelResult } from "../src/panel.ts";

initTheme("dark");
// The real Pi theme is supplied to components by custom().
const { theme } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function harness() {
  const session = SessionManager.inMemory();
  session.appendMessage({ role: "user", content: "Main task", timestamp: Date.now() });
  const events = new Map<string, () => void>();
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let editor = "Existing draft";
  let panel: SidePanel | undefined;
  let rows = 40;
  let complete: (signal: AbortSignal) => Promise<unknown> = async () => ({ stopReason: "stop", content: [{ type: "text", text: "Answer with 中文 and Türkçe" }] });
  const notices: string[] = [];
  const ctx = {
    mode: "tui", model: { id: "fake" }, sessionManager: session,
    modelRegistry: { complete: async (_model: unknown, _context: unknown, opts: { signal: AbortSignal }) => complete(opts.signal) },
    ui: {
      notify: (text: string) => notices.push(text),
      getEditorText: () => editor,
      setEditorText: (text: string) => { editor = text; },
      custom: async (factory: (tui: TUI, th: typeof theme, keys: unknown, done: (result: PanelResult) => void) => SidePanel) => new Promise<PanelResult>(resolve => {
        panel = factory({ terminal: { get rows() { return rows; } }, requestRender() {} } as TUI, theme, {}, resolve);
      }),
    },
  } as unknown as ExtensionCommandContext;
  sideExtension({
    on: (event: string, handler: () => void) => events.set(event, handler),
    registerCommand: (_name: string, def: { handler: typeof command }) => { command = def.handler; },
    appendEntry: (type: string, data: unknown) => session.appendCustomEntry(type, data),
  } as unknown as ExtensionAPI);
  return { session, ctx, notices, run: (args = "") => command(args, ctx), get panel() { return panel!; }, get editor() { return editor; }, setRows: (value: number) => { rows = value; }, emit: (event: string) => events.get(event)?.(), setComplete: (fn: typeof complete) => { complete = fn; } };
}

test("open, follow-up, close, reopen and share preserve the main draft", async () => {
  const h = harness();
  const first = h.run("Why?");
  await settle();
  assert.equal(restore(h.session.getBranch())!.turns.length, 1);
  h.panel.handleInput("Follow up");
  h.panel.handleInput("\r");
  await settle();
  assert.equal(restore(h.session.getBranch())!.turns.length, 2);
  h.panel.handleInput("\x1b");
  await first;
  assert.equal(h.editor, "Existing draft");
  const second = h.run();
  h.panel.handleInput("\x13"); // Ctrl+S
  await second;
  assert.match(h.editor, /^Existing draft\n\nFrom our side conversation/);
  assert.match(h.editor, /Follow up/);
  assert.equal(h.session.buildSessionContext().messages.length, 1);
});

test("terminal rendering fits wide, narrow and very small sizes", async () => {
  const h = harness();
  const done = h.run("Explain");
  await settle();
  for (const [width, rows] of [[100, 40], [40, 24], [20, 12], [8, 8], [1, 4]]) {
    h.setRows(rows);
    const lines = h.panel.render(width);
    assert.ok(lines.length <= rows);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${visibleWidth(line)}`);
  }
  h.panel.close();
  await done;
});

test("session switch cancels in-flight response, including providers ignoring cancellation", async () => {
  const h = harness();
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  h.setComplete(async input => { signal = input; return new Promise(resolve => { finish = resolve; }); });
  const done = h.run("Pending");
  await settle();
  h.emit("session_before_switch");
  assert.equal(signal.aborted, true);
  finish({ stopReason: "stop", content: [{ type: "text", text: "Stale" }] });
  await done;
  await settle();
  assert.equal(restore(h.session.getBranch())!.turns.length, 0);
});

test("Escape cancels first, closes second; retry and reset work", async () => {
  const h = harness();
  h.setComplete(signal => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
  const done = h.run("Pending");
  await settle();
  h.panel.handleInput("\x1b");
  await settle();
  assert.equal(restore(h.session.getBranch())!.turns.length, 0);
  assert.match(h.panel.render(90).join("\n"), /cancelled/);
  h.setComplete(async () => ({ stopReason: "stop", content: [{ type: "text", text: "Retried" }] }));
  h.panel.handleInput("\r");
  await settle();
  assert.equal(restore(h.session.getBranch())!.turns.length, 1);
  h.panel.close();
  await done;
  const oldId = restore(h.session.getBranch())!.id;
  const next = h.run("new");
  assert.notEqual(restore(h.session.getBranch())!.id, oldId);
  h.panel.close();
  await next;
});

test("non-TUI mode, no model, and sharing an empty conversation make no provider request", async () => {
  const h = harness();
  h.ctx.mode = "rpc";
  await h.run("Question");
  assert.match(h.notices.pop()!, /interactive terminal/);
  h.ctx.mode = "tui";
  h.ctx.model = undefined;
  await h.run();
  assert.match(h.notices.pop()!, /Select a model/);
  await h.run("share");
  assert.match(h.notices.pop()!, /No side answer/);
  assert.equal(h.session.getBranch().length, 1);
});
