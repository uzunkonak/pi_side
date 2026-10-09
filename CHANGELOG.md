# Changelog

## 0.1.0 — 2026-10-09

Initial release.

- Open a separate conversation panel with `/side [question]`.
- Capture the current main conversation as a fixed text snapshot, respecting compaction.
- Keep side exchanges out of the main model context and restore them from Pi session metadata.
- Start over with `/side new [question]`.
- Share the last exchange as an editable main-editor draft using `/side share` or Ctrl+S.
- Cancel side requests without aborting the main agent; discard late responses after cancellation or session changes.
- Use the selected Pi model and provider configuration without enabling tools in the side conversation.
