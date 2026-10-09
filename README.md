# pi_side

A [Pi](https://pi.dev) extension for side conversations without losing your place in the main task.

Ask questions, explore alternatives, and bring useful answers back as editable drafts without interrupting your workflow. Side conversations keep their own history and use your existing model and provider settings.

Open `/side`, ask a question, and keep chatting in a separate terminal panel. The panel starts with a text snapshot of the current conversation. Its questions and answers stay out of the main model's context until you choose to bring an answer back.

## Install

Install directly from GitHub:

```bash
pi install git:github.com/uzunkonak/pi_side
```

Pin the first release with `pi install git:github.com/uzunkonak/pi_side@v0.1.0`.

Or install from npm:

```bash
pi install npm:@uzunkonak/pi_side
```

## Try locally

From this repository:

```bash
pi -e ./extensions/side.ts
```

Or install this checkout as a local Pi package:

```bash
pi install /absolute/path/to/pi_side
```

Start a new Pi session or use `/reload` after installation. Tested with Pi **0.84.4** and Node.js **22.19+**. Host packages use wildcard peer ranges as required by Pi's package conventions; newer Pi versions have not yet been verified.

## Use

```text
/side                       Open or resume this branch's side conversation
/side Why this approach?     Ask a question and open the panel
/side new                    Start over with a fresh snapshot of the main chat
/side new Compare options    Start over and ask a question
/side share                  Add the last question and answer to the main editor
/side ask new                Ask the literal question “new”
/side help                   Show the controls
```

Inside the panel:

| Key | Action |
| --- | --- |
| Enter | Send a question or follow-up |
| Page Up / Page Down | Scroll the conversation |
| Esc or Ctrl+C while waiting | Cancel only the side request; keep the question for retry |
| Esc or Ctrl+C while idle | Close the panel; keep completed exchanges |
| Ctrl+S | Close and add the last exchange to the main editor |

Sharing creates an editable draft and preserves any text already in the main editor. It does not submit the draft or start a main-agent turn.

## Behavior

- Uses the model selected when the panel opens and Pi's existing provider/auth configuration. No separate API key is needed. Side requests consume that provider's normal usage allowance.
- The context snapshot respects Pi compaction. It remains fixed while the side conversation continues; `/side new` refreshes it. Only text from the conversation is copied, not image data or the main system prompt.
- The side model can discuss the snapshot but has no tools: it cannot read new files, edit code, or run commands.
- Completed exchanges are saved as custom session entries, outside the main model context. Closing, reopening, and resuming a saved session preserves them. Navigating the session tree restores the side history belonging to that branch. A new side conversation supersedes the earlier one on that branch without deleting its older records.
- Persistence follows Pi's session behavior: `--no-session` is ephemeral, and a brand-new main session is not written to disk until its first main assistant message. Side metadata is stored in the same session file, not a separate private or encrypted store.
- Cancelling, closing, or switching sessions aborts the side request. Late responses are discarded. Provider failures appear in the panel; the question stays available for retry.
- The panel uses Pi's custom overlay API and requires interactive TUI mode. Print, JSON, and RPC modes are not supported.

The snapshot keeps up to 32,000 characters of the most recent context and labels truncated snapshots. Side exchanges plus the next question have a 64,000-character limit; start a new side conversation when full. Replies are capped at 4,096 output tokens. These are character budgets, not exact token estimates, so a model with a small context window may reach its own limit earlier. Responses appear when complete.

`pi_retry` can be installed alongside this extension. Side requests use the model registry directly rather than the main agent loop, so `pi_retry`'s main-agent wait/resume handlers do not retry side requests.

## Development

```bash
npm install
npm run check       # TypeScript + state, isolation, lifecycle and panel tests
npm run test:e2e    # Real Pi terminal smoke test; Python 3 and a Unix PTY required
npm pack --dry-run
```

The terminal test uses an in-process fake provider and isolated temporary Pi configuration. It exercises opening, follow-ups, reopening, and sharing without network calls or real credentials. Its terminal transcript is written to `output/terminal-smoke.log`.

## Publishing

The package name is `@uzunkonak/pi_side`. Keep `package.json`, `CHANGELOG.md`, and the Git release tag (`v0.1.0` for version `0.1.0`) aligned. GitHub topics describe the repository; npm's `latest` dist-tag selects the stable package version. The `pi-package` npm keyword is required for discovery in the [Pi package gallery](https://pi.dev/packages).

From the clean release checkout, after verifying the npm account has access to the `@uzunkonak` scope:

```bash
npm run check
npm run test:e2e
npm publish --dry-run
npm publish --access public --tag latest
npm view @uzunkonak/pi_side version dist-tags keywords
```

`prepublishOnly` runs the typecheck and tests before publishing. Only `extensions`, `src`, the README, changelog, license, and package manifest are included in the npm package.

## License

[MIT](LICENSE) © Caner Uzunkonak
