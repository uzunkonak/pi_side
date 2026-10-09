import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, Markdown, matchesKey, truncateToWidth, visibleWidth, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { ConversationRunner } from "./conversation.ts";

export type PanelResult = "close" | "share";

/** Focused overlay; model work has its own abort signal, never the main agent's. */
export class SidePanel implements Focusable {
  private input = new Input();
  private offset = 0;
  private error = "";
  private pending = "";
  private closed = false;
  private generation = 0;
  private ticker: ReturnType<typeof setInterval>;
  private markdown: Markdown;
  private renderedText = "";
  private done: (result: PanelResult) => void;
  private tui: TUI;
  private theme: Theme;
  private runner: ConversationRunner;
  private modelLabel: string;

  constructor(tui: TUI, theme: Theme, runner: ConversationRunner, modelLabel: string, done: (result: PanelResult) => void, question = "") {
    this.tui = tui;
    this.theme = theme;
    this.runner = runner;
    this.modelLabel = modelLabel;
    this.done = done;
    this.markdown = new Markdown("", 0, 0, getMarkdownTheme());
    this.input.onSubmit = value => { void this.submit(value); };
    this.ticker = setInterval(() => { if (this.runner.busy) this.tui.requestRender(); }, 300);
    this.ticker.unref?.();
    if (question) void this.submit(question);
  }

  get focused() { return this.input.focused; }
  set focused(value: boolean) { this.input.focused = value; }

  private async submit(value: string) {
    if (this.closed || this.runner.busy || !value.trim()) return;
    const generation = ++this.generation;
    this.error = "";
    this.pending = value.trim();
    this.offset = 0;
    this.input.setValue("");
    this.tui.requestRender();
    try {
      const committed = await this.runner.ask(value);
      if (!committed && !this.closed && generation === this.generation) this.input.setValue(value);
    } catch (error) {
      if (!this.closed && generation === this.generation) {
        this.error = error instanceof Error ? error.message : String(error);
        this.input.setValue(value);
      }
    } finally {
      if (!this.closed && generation === this.generation) {
        this.pending = "";
        this.tui.requestRender();
      }
    }
  }

  close(result: PanelResult = "close") {
    if (this.closed) return;
    this.dispose();
    this.done(result);
  }

  handleInput(data: string) {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      if (this.runner.busy) {
        ++this.generation;
        this.runner.cancel();
        this.input.setValue(this.pending);
        this.pending = "";
        this.error = "Request cancelled. Edit and press Enter to retry; Esc closes.";
      } else this.close();
    } else if (matchesKey(data, "ctrl+s")) {
      if (!this.runner.busy && this.runner.chat.turns.length) this.close("share");
    } else if (matchesKey(data, "pageUp")) {
      this.offset += 8;
    } else if (matchesKey(data, "pageDown")) {
      this.offset = Math.max(0, this.offset - 8);
    } else if (!this.runner.busy) this.input.handleInput(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const w = Math.max(1, width);
    const inner = Math.max(1, w - 4);
    const height = Math.max(1, Math.min(32, this.tui.terminal.rows - 4));
    const th = this.theme;
    const row = (value: string) => {
      const text = truncateToWidth(value, inner);
      return truncateToWidth(th.fg("border", "│ ") + text + " ".repeat(Math.max(0, inner - visibleWidth(text))) + th.fg("border", " │"), w);
    };
    const rule = (left: string, right: string) => truncateToWidth(th.fg("border", left + "─".repeat(Math.max(0, w - 2)) + right), w);
    const transcript = this.runner.chat.turns.map(turn => `**You**\n\n${turn.question}\n\n**Side**\n\n${turn.answer}`).join("\n\n---\n\n");
    const text = transcript + (this.pending ? `\n\n**You**\n\n${this.pending}` : "");
    if (text !== this.renderedText) { this.markdown.setText(text); this.renderedText = text; }
    const content = text ? this.markdown.render(inner) : [th.fg("dim", "Ask a question about the main conversation."), "", th.fg("dim", "This chat has its own history. No tools are run.")];
    const bodyHeight = Math.max(1, height - 7);
    this.offset = Math.min(this.offset, Math.max(0, content.length - bodyHeight));
    const end = content.length - this.offset;
    const body = content.slice(Math.max(0, end - bodyHeight), end);
    while (body.length < bodyHeight) body.push("");
    const spinner = ["◐", "◓", "◑", "◒"][Math.floor(Date.now() / 300) % 4];
    const status = this.runner.busy ? `${spinner} Thinking… · Esc cancels` : this.error || `${this.runner.chat.turns.length} exchanges · ${this.runner.chat.contextTruncated ? "recent context only" : "context snapshot"}${this.offset ? " · scrolled up" : ""}`;
    return [
      rule("╭", "╮"),
      row(th.fg("accent", "Side conversation") + th.fg("dim", ` · ${this.modelLabel}`)),
      row(th.fg(this.error ? "warning" : "dim", status)),
      ...body.map(row),
      rule("├", "┤"),
      row(this.runner.busy ? th.fg("dim", "Waiting for response…") : this.input.render(inner)[0] ?? ""),
      row(th.fg("dim", "Enter send · PgUp/PgDn scroll · Ctrl+S to main · Esc close")),
      rule("╰", "╯"),
    ].slice(0, height);
  }

  invalidate() { this.markdown.invalidate(); this.input.invalidate(); }
  dispose() {
    this.closed = true;
    ++this.generation;
    this.runner.cancel();
    clearInterval(this.ticker);
  }
}
