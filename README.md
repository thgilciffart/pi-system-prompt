# system-prompt

Use a Markdown file to prepend, append, or replace [Pi](https://pi.dev)'s system prompt.

## Install

Requires Pi 1.x and Node.js 22.19 or later.

```sh
pi install npm:system-prompt
```

Run `/reload` in an open Pi session.

## Add and select a prompt

Create the prompt directory:

```sh
mkdir -p ~/.pi/agent/system-prompts
```

Save a file such as `~/.pi/agent/system-prompts/reviewer.md`:

```markdown
You review code changes. Look for bugs, regressions, and missing tests.
Explain each finding with a file path and a concrete failure case.
```

Run `/system-prompt` to choose a file, or select it by name:

```text
/system-prompt use reviewer
```

The selection applies on your next message. Append is the default mode. The extension remembers your selection and rereads the file before each run. Files in subdirectories also appear as separate prompts.

## Change the mode

```text
/system-prompt mode prepend
/system-prompt mode append
/system-prompt mode replace
```

Replace discards the incoming system prompt, including Pi's built-in instructions and loaded context. Tool definitions and conversation history remain. See [prompt behavior](docs/reference.md#prompt-behavior) for extension ordering and error handling.

## Inspect or toggle

| Command | Action |
| --- | --- |
| `/system-prompt list` | List prompt files. |
| `/system-prompt status` | Show the selection, mode, settings paths, and errors. |
| `/system-prompt view` | View Pi's complete current system prompt. Send a message after changes to apply them first. |
| `/system-prompt view reviewer` | Read a file without selecting it. |
| `/system-prompt toggle` | Disable or enable the selected file without forgetting it. |

The viewer requires terminal mode. Scroll with arrow keys or Page Up and Page Down. Press Esc or `q` to close.

For a process-only override, start Pi with:

```sh
pi --system-prompt-name reviewer --system-prompt-mode prepend
```

Startup flags also work in print and RPC modes. They do not save settings, but a later settings command saves the current state, including overrides.

See the [command and settings reference](docs/reference.md) or [development guide](docs/development.md).

[MIT license](LICENSE).
