# Commands and settings

## Commands

Arguments support tab completion. Names are case-sensitive paths relative to the prompt directory, such as `review/backend.md`. Names with spaces need no quotes.

| Command | Behavior |
| --- | --- |
| `/system-prompt` | Opens the picker and enables the selected file. |
| `/system-prompt use <name>` | Selects and enables a file. `.md` is optional when unambiguous. |
| `/system-prompt mode [mode]` | Opens the mode picker or sets `prepend`, `append`, or `replace`. Keeps the enabled state. |
| `/system-prompt list` | Lists files. An asterisk marks the selection, even when disabled. |
| `/system-prompt status` | Shows the enabled state, selection, mode, paths, and errors. |
| `/system-prompt toggle` | Toggles the selected file. Checks the file before enabling it; requires a selection. |
| `/system-prompt view [name]` | Previews the selected prompt and mode, or reads a named file without selecting it. |
| `/system-prompt help` | Shows usage. |

Pickers require dialog support. Explicit commands also work with RPC clients, except the viewer, which requires terminal mode.

## Full-screen viewer

The viewer displays wrapped plain text and removes terminal control sequences. It does not edit files or start a model request.

| Key | Action |
| --- | --- |
| Up, Down, `k`, `j` | Scroll one line. |
| Page Up, Page Down, Space | Scroll by page. Space moves down. |
| Home, End, `g`, `G` | Jump to the start or end. |
| Esc, `q`, Ctrl+C | Close. |

Pi's selection keys also apply. Mouse wheel scrolling works when Pi forwards mouse events.

With no name, `view` rereads the selected file and applies the current mode. Selection, toggle, mode, and file changes appear immediately, before another message is sent. Viewing does not save settings.

The preview uses the incoming prompt captured at the start of the most recent run. Before the first run in a session, it uses Pi's current prompt. Disabling the extension previews that incoming prompt. Earlier extensions' changes appear after a run; later extensions and provider-specific changes are outside this preview. If the selected file cannot be read, the viewer reports an error.

## Prompt directory

Prompts live in `~/.pi/agent/system-prompts/`. `PI_CODING_AGENT_DIR` moves both the prompt directory and settings file.

Discovery includes regular Markdown files in subdirectories, including hidden files, with a case-insensitive `.md` extension. It excludes symlinks. Reads reject paths outside the prompt directory. A missing directory is an empty library.

Each entire UTF-8 file is one prompt, including headings, frontmatter, and whitespace. Empty or whitespace-only files are rejected. Selecting a file does not load other files.

## Prompt behavior

The extension starts disabled with no selection and `append` mode. Selecting a file enables it.

It changes `event.systemPrompt` during `before_agent_start`. Given an incoming prompt `base` and file content `custom`:

| Mode | Result |
| --- | --- |
| `prepend` | `custom + "\n\n" + base` |
| `append` | `base + "\n\n" + custom` |
| `replace` | `custom` |

If `base` is empty, every mode returns `custom` without a separator.

The incoming prompt includes earlier extensions' changes. Later extensions can modify this result. Replace removes the incoming instructions, including Pi context, `AGENTS.md`, skills, and command-line prompt additions. It does not remove tool definitions or history. Text position does not guarantee instruction priority.

The file is read before each run, without accumulating copies. File edits and command changes during a run apply to the next run.

If the file is missing, unreadable, empty, or outside the directory, the extension keeps the incoming prompt and reports an error. It retries next run. The footer shows `system-prompt: error`; identical errors do not repeat notifications. Print and JSON modes report errors to standard error.

## Saved settings

Settings live in `~/.pi/agent/system-prompt.json`, separate from Pi's `settings.json`.

```json
{
	"enabled": true,
	"prompt": "reviewer.md",
	"mode": "append"
}
```

`enabled` is a boolean, `prompt` is a relative Markdown path or `null`, and `mode` is `prepend`, `append`, or `replace`.

Settings commands save all fields through a temporary file and rename. In-memory state changes after saving succeeds. New settings files have owner-only permissions where supported. Commands do not edit prompt files.

Settings supply defaults for future processes. Other running Pi processes keep their state. Session switches and forks keep the current selection; resumed conversations use current settings.

Invalid settings disable the extension and appear in `status`. Commands refuse to overwrite them. After repairing or removing the settings file, `/reload` reads it again.

## Startup flags

| Flag | Behavior |
| --- | --- |
| `--system-prompt-name <name>` | Selects and enables a prompt for this process. |
| `--system-prompt-mode <mode>` | Overrides the mode without enabling the prompt. |

Pi reserves `--system-prompt` for its built-in option. Startup flags do not save settings. A later settings command saves the current state, including overrides.

An invalid flag disables the custom prompt for the process without changing saved settings. A successful settings command clears the flag error.
