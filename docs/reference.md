# Commands and settings

## Commands

The extension registers `/system-prompt`. Command arguments support tab completion.

| Command | Behavior |
| --- | --- |
| `/system-prompt` | Opens the prompt picker and enables the selected prompt with the current mode. |
| `/system-prompt use <name>` | Selects and enables a prompt. The `.md` extension is optional when the name is unambiguous. |
| `/system-prompt mode` | Opens the mode picker. |
| `/system-prompt mode <mode>` | Sets `prepend`, `append`, or `replace`. Does not enable a disabled prompt. |
| `/system-prompt list` | Lists available prompt paths. An asterisk marks the selected prompt, even when disabled. |
| `/system-prompt status` | Shows the enabled state, selected prompt, mode, paths, and active errors. Checks the file when enabled. |
| `/system-prompt toggle` | Switches the enabled state and keeps the selected file and mode. Checks the file before enabling it. Reports an error if no prompt is selected. |
| `/system-prompt view` | Opens Pi's complete current system prompt in a full-screen viewer. |
| `/system-prompt view <name>` | Opens a Markdown file in the viewer without selecting it or changing settings. |
| `/system-prompt help` | Shows command usage. |

Names are case-sensitive relative paths, such as `review/backend.md`. A name can contain spaces. `/system-prompt use code review.md` selects that whole filename without quotes. The picker requires dialog support. Explicit commands also work with RPC clients.

## Full-screen viewer

The viewer fills the terminal and displays plain text with line wrapping. Markdown headings and frontmatter remain visible. The viewer never edits the prompt. It removes terminal control sequences from the display.

`view` reads `ctx.getSystemPrompt()`, which contains the prompt Pi currently holds. After a run, the view includes any built-in instructions and extension changes present in that prompt. A pending selection, toggle, file edit, or mode change does not affect this view until Pi starts the next run. The viewer does not start a model request or compose the custom prompt a second time. Provider-specific request changes can still alter what the model receives.

The default view also works when the plugin is disabled or no Markdown file is selected. `view <name>` reads the named file directly from the prompt directory.

| Key | Action |
| --- | --- |
| Up, Down, `k`, `j` | Scroll one line. |
| Page Up, Page Down, Space | Scroll by page. Space scrolls down. |
| Home, End, `g`, `G` | Jump to the start or end. |
| Escape, `q`, Ctrl+C | Close the viewer and return to Pi. |

The viewer also honors Pi's configured selection keys. Terminal resize changes the viewport and wraps the text again. The footer shows the visible line range after wrapping. Mouse wheel events scroll the text when Pi forwards them in fullscreen terminal mode.

The viewer requires interactive terminal mode. RPC, JSON, and print modes do not support custom terminal screens. Other commands and startup flags remain available in their supported modes.

## Prompt directory

The default directory is `~/.pi/agent/system-prompts/`. The extension uses Pi's agent directory, so `PI_CODING_AGENT_DIR` moves both the prompt directory and the settings file.

The extension searches subdirectories for regular files with a `.md` extension, ignoring extension case. Hidden files are included. Symbolic links are excluded from discovery. Paths that escape the prompt directory are rejected when read. A missing directory is an empty library.

The entire UTF-8 file is the prompt, including headings and any YAML frontmatter. Whitespace is preserved. Empty files and files that contain only whitespace are rejected. Files are independent prompts. Selecting one does not load other Markdown files.

## Prompt behavior

The plugin starts disabled, with no selected file and `append` as the mode. A successful selection enables it.

The extension changes `event.systemPrompt` in Pi's `before_agent_start` event. Given an incoming prompt `base` and a selected file `custom`, the modes produce the following strings.

| Mode | Result |
| --- | --- |
| `prepend` | `custom + "\n\n" + base` |
| `append` | `base + "\n\n" + custom` |
| `replace` | `custom` |

If the incoming prompt is empty, every mode returns `custom` without a separator.

The incoming prompt includes changes from earlier extensions. Later extensions can modify this plugin's result. Prepend and append retain the incoming prompt. Replace discards it, including instructions from Pi, `AGENTS.md`, skills, and command-line prompt additions that Pi included there. Replace does not remove tool definitions or conversation history. Text position alone does not guarantee that a model follows one instruction over another.

The extension reads the selected file before each run. It does not reread the file between tool calls within a run. Command changes apply to the next run, including when a command runs while Pi is busy. The extension starts from the incoming prompt each time, so it does not accumulate copies across runs.

If a selected file is missing, unreadable, empty, or outside the prompt directory, the extension reports an error and keeps the incoming prompt for that run. It retries the file on the next run. The footer displays `system-prompt: error` until the file recovers or the configuration changes. Repeated runs with the same error do not repeat the notification.

In print and JSON modes, prompt errors go to standard error because Pi has no notification UI in those modes.

## Saved settings

Settings live in `~/.pi/agent/system-prompt.json`, separate from Pi's `settings.json`.

```json
{
	"enabled": true,
	"prompt": "reviewer.md",
	"mode": "append"
}
```

| Field | Accepted values |
| --- | --- |
| `enabled` | A boolean. |
| `prompt` | A relative Markdown path or `null`. |
| `mode` | `prepend`, `append`, or `replace`. |

Commands that change settings save all three fields through a temporary file and rename. The in-memory state changes only after the save succeeds. New settings files have owner-only permissions where the operating system supports them. The extension never edits prompt files.

Settings apply to the current Pi process and provide defaults for future processes. Other running processes keep their own state. Each save replaces the stored settings. Session switches and forks keep the current process's selection. Resuming an old conversation uses the current settings rather than its historical prompt selection.

Invalid settings disable the plugin and appear in `/system-prompt status`. Commands do not overwrite invalid settings. After a file repair or removal, `/reload` reads the settings again.

## Startup flags

| Flag | Behavior |
| --- | --- |
| `--system-prompt-name <name>` | Selects and enables a prompt for the process. Accepts the same names as `use`. |
| `--system-prompt-mode <mode>` | Overrides the mode without changing whether the plugin is enabled. |

The selection flag is `--system-prompt-name` because Pi reserves `--system-prompt` for its built-in prompt option.

Startup flags do not save settings. A subsequent command that changes settings saves the current state. An invalid flag value disables the custom prompt for that process and leaves the saved file unchanged. A successful settings command clears the flag error.

## Compatibility

The extension targets Pi 1.x through `@earendil-works/pi-coding-agent`. Pi loads its TypeScript source directly. The package has no bundled copy of Pi and no runtime dependencies beyond the Pi host and Node.js.

Pi's [extension contract](https://pi.dev/docs/latest/extensions) defines prompt event ordering. The [package documentation](https://pi.dev/docs/latest/packages) defines the manifest and the `pi-package` keyword used for gallery discovery.
