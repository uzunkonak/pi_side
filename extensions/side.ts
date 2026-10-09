import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ConversationRunner, ENTRY_TYPE, restore, shareDraft, snapshot, startRecord } from "../src/conversation.ts";
import { SidePanel, type PanelResult } from "../src/panel.ts";

const commands = [
  { value: "new", label: "new [question]", description: "Start a fresh side conversation with current context" },
  { value: "share", label: "share", description: "Copy the last answer to the main editor for review" },
  { value: "ask", label: "ask <question>", description: "Ask a question (including one starting with a command word)" },
  { value: "help", label: "help", description: "Show side conversation controls" },
];

export default function sideExtension(pi: ExtensionAPI) {
  let panel: SidePanel | undefined;
  let opening = false;
  let lifecycle = 0;
  function close() { lifecycle++; panel?.close(); panel = undefined; }
  pi.on("session_start", close);
  pi.on("session_shutdown", close);
  pi.on("session_before_switch", close);
  pi.on("session_before_tree", close);

  function toEditor(ctx: ExtensionContext, draft: string) {
    const existing = ctx.ui.getEditorText();
    ctx.ui.setEditorText(existing ? `${existing}\n\n${draft}` : draft);
    ctx.ui.notify("Side answer added to the main editor. Review and submit when ready.", "info");
  }

  pi.registerCommand("side", {
    description: "Open a private side conversation using the current context",
    getArgumentCompletions: prefix => commands.filter(command => command.value.startsWith(prefix)),
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/side requires Pi's interactive terminal mode.", "warning");
        return;
      }
      if (opening) { ctx.ui.notify("A side conversation is already open.", "info"); return; }
      const text = args.trim();
      if (text === "help") {
        ctx.ui.notify("/side [question] — open or continue\n/side new [question] — refresh context and start over\n/side share — put the last exchange into the main editor\n/side ask <question> — escape command words\nEnter sends · PgUp/PgDn scroll · Esc cancels/closes · Ctrl+S shares", "info");
        return;
      }
      let chat = restore(ctx.sessionManager.getBranch());
      if (text === "share") {
        const draft = chat && shareDraft(chat);
        if (draft) toEditor(ctx, draft);
        else ctx.ui.notify("No side answer to share yet.", "info");
        return;
      }
      if (!ctx.model) { ctx.ui.notify("Select a model before opening /side.", "warning"); return; }
      const fresh = /^new(?:\s|$)/.test(text);
      const question = fresh ? text.replace(/^new\s*/, "") : text.replace(/^ask(?:\s+|$)/, "");
      if (!chat || fresh) {
        chat = snapshot(ctx.sessionManager.getBranch());
        pi.appendEntry(ENTRY_TYPE, startRecord(chat));
      }
      const conversation = chat;
      const model = ctx.model;
      const sessionId = ctx.sessionManager.getSessionId();
      const epoch = lifecycle;
      const runner = new ConversationRunner(conversation,
        (context, signal, id) => ctx.modelRegistry.complete(model, context, { signal, sessionId: id, maxTokens: 4096 }),
        record => {
          if (epoch !== lifecycle || ctx.sessionManager.getSessionId() !== sessionId) throw new Error("The main session changed; side response discarded.");
          pi.appendEntry(ENTRY_TYPE, record);
        });
      opening = true;
      try {
        const result = await ctx.ui.custom<PanelResult>((tui, theme, _keys, done) => {
          panel = new SidePanel(tui, theme, runner, model.id, done, question);
          return panel;
        }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "95%", anchor: "center" } });
        if (result === "share" && epoch === lifecycle && ctx.sessionManager.getSessionId() === sessionId) {
          const draft = shareDraft(conversation);
          if (draft) toEditor(ctx, draft);
        }
      } catch (error) {
        ctx.ui.notify(`side: ${error instanceof Error ? error.message : String(error)}`, "error");
      } finally {
        runner.cancel();
        panel?.dispose();
        panel = undefined;
        opening = false;
      }
    },
  });
}
