# pi-sys-prompt

Choose a Markdown file as Pi's system prompt. Prepend it, append it, or replace the full prompt.

## Install

```sh
pi install npm:pi-sys-prompt
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

Run `/sys-prompt` to open the prompt picker, or select the file by name.

```text
/sys-prompt use reviewer
```

The footer shows `sys-prompt: reviewer.md (append)`. The prompt applies when you send your next message.

To change how Pi applies the file, set a mode.

```text
/sys-prompt mode prepend
/sys-prompt mode append
/sys-prompt mode replace
```

Append is the default. Replace uses the file as the entire system prompt at this extension's position in the extension order. That removes Pi's built-in instructions and loaded context from the incoming system prompt. See [prompt behavior](docs/reference.md#prompt-behavior) before using replace.

The extension remembers your selection and mode across restarts. File edits take effect on the next run.

## Inspect or disable the prompt

List the available files or inspect the selected prompt and settings paths.

```text
/sys-prompt list
/sys-prompt status
```

Disable the prompt without forgetting your selection.

```text
/sys-prompt off
```

To enable the selected prompt again, run `/sys-prompt on`.

## Override the prompt for one process

Pass a prompt name and mode when you start Pi.

```sh
pi --sys-prompt reviewer --sys-prompt-mode prepend
```

These flags also work in print and RPC modes. Startup overrides do not write settings. A later `/sys-prompt` command that changes settings saves the current selection and mode, including overrides.

See the [command and settings reference](docs/reference.md) for all options and the [development guide](docs/development.md) for local testing and npm publishing.
