# system-prompt

Choose Markdown system prompts for [Pi](https://pi.dev) and prepend, append, or replace the default prompt.

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

Replace uses your file as the complete prompt. Include the placeholders below to keep Pi's dynamic sections. Tool definitions and conversation history remain. See [prompt behavior](docs/reference.md#prompt-behavior) for extension ordering and error handling.

## Include dynamic Pi context

Use placeholders in your Markdown to put Pi's context where you want it. For example, save this as `~/.pi/agent/system-prompts/custom.md`:

```markdown
You are my coding assistant. Explain your decisions clearly.

Working directory: {{cwd}}

{{rules}}

{{docs}}

{{skills}}

{{project_context}}
```

Select it in replace mode, then preview the expanded prompt:

```text
/system-prompt use custom
/system-prompt mode replace
/system-prompt view
```

Use Pi 1.4 or later for dynamic sections. The extension refreshes values before each run. `{{system_prompt}}` inserts the entire incoming Pi prompt, including earlier extensions' changes. Use replace mode with that placeholder to include the incoming prompt once.

See the [placeholder reference](docs/reference.md#placeholders) for each value, or copy [the dynamic prompt example](examples/dynamic.md).

## Inspect or toggle

| Command | Action |
| --- | --- |
| `/system-prompt list` | List prompt files. |
| `/system-prompt status` | Show the selection, mode, settings paths, and errors. |
| `/system-prompt view` | Preview the selected prompt and mode immediately. |
| `/system-prompt view reviewer` | Read a file without selecting it. |
| `/system-prompt toggle` | Disable or enable the selected file without forgetting it. |

The `system-prompt` status line in Pi's footer is only shown in the terminal UI, not when Pi is driven over RPC by a client such as T3 Code.

The viewer requires terminal mode. Scroll with arrow keys or Page Up and Page Down. Press Esc or `q` to close.

For a process-only override, start Pi with:

```sh
pi --system-prompt-name reviewer --system-prompt-mode prepend
```

Startup flags also work in print and RPC modes. They do not save settings, but a later settings command saves the current state, including overrides.

See the [command and settings reference](docs/reference.md) or [development guide](docs/development.md).

[MIT license](LICENSE).
