# Changelog

## 0.1.4

- Set the `system-prompt` status line only in TUI mode, so RPC clients such as T3 Code no longer receive it as a popup.
- Expand `{{system_prompt}}`, `{{cwd}}`, `{{skills}}`, `{{project_context}}`, `{{docs}}`, and `{{rules}}` in Markdown prompts before each run.
- Show expanded placeholders in the selected prompt preview. Named file views retain the source text.
- Add a dynamic prompt example and document placeholder behavior.

## 0.1.2

- Preview the selected prompt, mode, and file edits immediately with `/system-prompt view`.
- Avoid duplicating custom content when viewing a prompt after a run.

## 0.1.1

- Update the npm repository, homepage, and issue links to `thgilciffart/pi-system-prompt`.

## 0.1.0

- Select Markdown system prompts from Pi's agent directory.
- Prepend, append, or replace the incoming system prompt.
- List prompts, change modes, toggle prompts, and inspect status with `/system-prompt`.
- View Pi's complete current system prompt or a named Markdown file in a full-screen viewer.
- Save selections across restarts and reread prompt files before each run.
- Override the selected prompt and mode with command-line flags.
