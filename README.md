# system-prompt

Choose a Markdown file as Pi's system prompt. Prepend it, append it, or replace the full prompt.

## Install

```sh
pi install npm:system-prompt
```

Run `/reload` in an open Pi session after installation. This extension targets Pi 1.x and Node.js 22.19 or newer.

## Add a prompt

Create the prompt directory.

```sh
mkdir -p ~/.pi/agent/system-prompts
```

Save the following text as `~/.pi/agent/system-prompts/reviewer.md`.

```markdown
You review code changes. Look for bugs, regressions, and missing tests.
Explain each finding with a file path and a concrete failure case.
```

The extension also finds `.md` files in subdirectories. Each file is one prompt. It does not combine files automatically.

## Choose a prompt

Run `/system-prompt` to open the prompt picker, or select the file by name.

```text
/system-prompt use reviewer
```

The footer shows `system-prompt: reviewer.md (append)`. The prompt applies when you send your next message.

To change how Pi applies the file, set a mode.

```text
/system-prompt mode prepend
/system-prompt mode append
/system-prompt mode replace
```

Append is the default. Replace uses the file as the entire system prompt at this extension's position in the extension order. That removes Pi's built-in instructions and loaded context from the incoming system prompt. See [prompt behavior](docs/reference.md#prompt-behavior) before using replace.

The extension remembers your selection and mode across restarts. File edits take effect on the next run.

## Inspect the prompt

List the available files or inspect the selected prompt and settings paths.

```text
/system-prompt list
/system-prompt status
```

Open Pi's complete current system prompt in a full-screen viewer.

```text
/system-prompt view
```

Use the arrow keys to scroll, Page Up and Page Down to move by page, and Home or End to jump. Press Escape or `q` to close.

The viewer shows the entire prompt Pi currently holds. After a run in prepend or append mode, the view includes Pi's built-in instructions and the custom prompt. After changing your selection or mode, send a message to apply the change before viewing the result.

To read a Markdown file without selecting it, run `/system-prompt view reviewer`. The full-screen viewer requires Pi's interactive terminal mode.

## Toggle the prompt

Enable or disable the selected prompt without forgetting your selection.

```text
/system-prompt toggle
```

The first toggle after a selection disables the custom prompt. The next toggle enables it again. To select a file first, run `/system-prompt use reviewer`.

## Override the prompt for one process

Pass a prompt name and mode when you start Pi.

```sh
pi --system-prompt-name reviewer --system-prompt-mode prepend
```

These flags also work in print and RPC modes. Startup overrides do not write settings. A later `/system-prompt` command that changes settings saves the current selection and mode, including overrides.

See the [command and settings reference](docs/reference.md) for all options and the [development guide](docs/development.md) for local testing and npm publishing.
