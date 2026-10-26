import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PromptViewer } from "./viewer.ts";
import {
	composePrompt, defaultSettings, isMode, listPrompts, loadSettings, MODES,
	readPrompt, resolvePrompt, saveSettings, type Paths, type Settings,
} from "./store.ts";

const HELP = [
	"/system-prompt                 Choose a prompt",
	"/system-prompt use <name>      Select and enable a prompt",
	"/system-prompt mode <mode>     Set prepend, append, or replace",
	"/system-prompt mode            Choose a mode",
	"/system-prompt list            List Markdown files",
	"/system-prompt status          Show settings and file health",
	"/system-prompt toggle          Enable or disable the selected prompt",
	"/system-prompt view            View Pi's complete current system prompt",
	"/system-prompt view <name>     View a Markdown file without selecting it",
	"/system-prompt help            Show these commands",
].join("\n");

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function registerPlugin(pi: ExtensionAPI, paths: Paths): Promise<void> {
	let settings = defaultSettings();
	let configError: string | undefined;
	let overrideError: string | undefined;
	let promptError: string | undefined;
	let lastWarning: string | undefined;
	let initialized = false;
	try {
		settings = await loadSettings(paths.settings);
	} catch (error) {
		configError = `Cannot load ${paths.settings}: ${errorMessage(error)} Repair or remove the file, then run /reload.`;
	}

	pi.registerFlag("system-prompt-name", { type: "string", description: "Select a system prompt for this Pi process" });
	pi.registerFlag("system-prompt-mode", { type: "string", description: "System prompt mode: prepend, append, or replace" });

	function updateFooter(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const status = configError || overrideError || promptError ? "system-prompt: error" : settings.enabled && settings.prompt
			? `system-prompt: ${settings.prompt} (${settings.mode})` : "system-prompt: off";
		ctx.ui.setStatus("system-prompt", status);
	}

	function warn(ctx: ExtensionContext, message: string): void {
		if (message === lastWarning) return;
		lastWarning = message;
		if (ctx.hasUI) ctx.ui.notify(message, "error");
		else process.stderr.write(`${message}\n`);
	}

	async function checkPrompt(selected = settings): Promise<{ custom?: string; error?: string }> {
		let custom: string | undefined;
		let error: string | undefined;
		try {
			if (selected.enabled) {
				if (!selected.prompt) throw new Error("No prompt selected. Run /system-prompt use <name>.");
				custom = await readPrompt(paths.prompts, selected.prompt);
			}
		} catch (cause) {
			error = errorMessage(cause);
		}
		if (selected === settings) promptError = error;
		return { custom, error };
	}

	async function initialize(ctx: ExtensionContext): Promise<void> {
		if (!initialized) {
			initialized = true;
			if (!configError) {
				try {
					const name = pi.getFlag("system-prompt-name");
					const mode = pi.getFlag("system-prompt-mode");
					const next = { ...settings };
					if (typeof mode === "string") {
						if (!isMode(mode)) throw new Error("--system-prompt-mode must be prepend, append, or replace.");
						next.mode = mode;
					}
					if (typeof name === "string") {
						next.prompt = await resolvePrompt(paths.prompts, name);
						await readPrompt(paths.prompts, next.prompt);
						next.enabled = true;
					}
					settings = next;
				} catch (error) {
					// An invalid override must not silently activate the saved prompt.
					settings = { ...settings, enabled: false };
					overrideError = errorMessage(error);
					warn(ctx, `system-prompt: ${overrideError} Custom prompt disabled.`);
					updateFooter(ctx);
					return;
				}
			}
		}
		if (configError) warn(ctx, configError);
		else {
			await checkPrompt();
			if (promptError) warn(ctx, `system-prompt: ${promptError} Keeping Pi's incoming system prompt.`);
		}
		updateFooter(ctx);
	}

	async function commit(next: Settings, ctx: ExtensionContext): Promise<void> {
		if (configError) throw new Error(configError);
		await saveSettings(paths.settings, next);
		settings = next;
		overrideError = undefined;
		promptError = undefined;
		lastWarning = undefined;
		updateFooter(ctx);
		ctx.ui.notify(settings.enabled
			? `System prompt: ${settings.prompt} (${settings.mode}). Applies to the next run.`
			: `Custom system prompt disabled. Mode: ${settings.mode}. Applies to the next run.`, "info");
	}

	async function usePrompt(name: string, ctx: ExtensionContext): Promise<void> {
		const prompt = await resolvePrompt(paths.prompts, name);
		await readPrompt(paths.prompts, prompt);
		await commit({ ...settings, enabled: true, prompt }, ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		await initialize(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!initialized) await initialize(ctx);
		if (configError || overrideError) return;
		// Keep the selected file and mode together if a command runs during the read.
		const selected = settings;
		const { custom, error } = await checkPrompt(selected);
		updateFooter(ctx);
		if (error) {
			warn(ctx, `system-prompt: ${error} Keeping Pi's incoming system prompt.`);
			return;
		}
		lastWarning = undefined;
		if (custom !== undefined) return { systemPrompt: composePrompt(event.systemPrompt, custom, selected.mode) };
	});

	pi.registerCommand("system-prompt", {
		description: "Manage system prompts and view Pi's complete current prompt",
		getArgumentCompletions: async (prefix) => {
			const commands = ["use", "mode", "list", "status", "toggle", "view", "help"];
			if (prefix.startsWith("mode ")) {
				return MODES.map((mode) => ({ value: `mode ${mode}`, label: mode })).filter((item) => item.value.startsWith(prefix));
			}
			if (prefix.startsWith("use ") || prefix.startsWith("view ")) {
				try {
					const command = prefix.startsWith("use ") ? "use" : "view";
					return (await listPrompts(paths.prompts)).map((id) => ({ value: `${command} ${id}`, label: id }))
						.filter((item) => item.value.startsWith(prefix));
				} catch {
					return null;
				}
			}
			return commands.filter((command) => command.startsWith(prefix)).map((command) => ({ value: command, label: command }));
		},
		handler: async (args, ctx) => {
			if (!initialized) await initialize(ctx);
			const input = args.trim();
			const command = input.split(/\s+/, 1)[0];
			const value = input.slice(command.length).trim();
			try {
				switch (command) {
					case "": {
						if (!ctx.hasUI) throw new Error("Use /system-prompt use <name> when dialogs are unavailable.");
						const prompts = await listPrompts(paths.prompts);
						if (!prompts.length) throw new Error(`No Markdown prompts found. Add a .md file to ${paths.prompts}.`);
						const selected = await ctx.ui.select("Choose a system prompt", prompts);
						if (selected !== undefined) await usePrompt(selected, ctx);
						break;
					}
					case "use":
						if (!value) throw new Error("Usage: /system-prompt use <name>");
						await usePrompt(value, ctx);
						break;
					case "mode": {
						if (!value && !ctx.hasUI) throw new Error("Usage: /system-prompt mode <prepend|append|replace>");
						const mode = value || await ctx.ui.select("Choose a system prompt mode", [...MODES]);
						if (mode === undefined) break;
						if (!isMode(mode)) throw new Error("Mode must be prepend, append, or replace.");
						await commit({ ...settings, mode }, ctx);
						break;
					}
					case "toggle":
						if (value) throw new Error("Usage: /system-prompt toggle");
						if (!settings.enabled) {
							if (!settings.prompt) throw new Error("No prompt selected. Run /system-prompt use <name>.");
							await readPrompt(paths.prompts, settings.prompt);
						}
						await commit({ ...settings, enabled: !settings.enabled }, ctx);
						break;
					case "view": {
						if (ctx.mode !== "tui") throw new Error("The full-screen prompt viewer requires Pi's interactive terminal mode.");
						const prompt = value ? await resolvePrompt(paths.prompts, value) : undefined;
						const content = prompt ? await readPrompt(paths.prompts, prompt) : ctx.getSystemPrompt();
						const title = prompt ? `Prompt file: ${prompt}` : "Current Pi system prompt";
						await ctx.ui.custom<void>((tui, theme, keybindings, done) =>
							new PromptViewer(tui, theme, keybindings, title, content, () => done()), {
								overlay: true,
								overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 },
							});
						break;
					}
					case "list": {
						if (value) throw new Error("Usage: /system-prompt list");
						const prompts = await listPrompts(paths.prompts);
						ctx.ui.notify(prompts.length
							? `System prompts in ${paths.prompts}:\n${prompts.map((id) => `${id === settings.prompt ? "* " : "  "}${id}`).join("\n")}`
							: `No Markdown prompts found. Add a .md file to ${paths.prompts}.`, "info");
						break;
					}
					case "status": {
						if (value) throw new Error("Usage: /system-prompt status");
						await checkPrompt();
						updateFooter(ctx);
						ctx.ui.notify([
							`State: ${configError || overrideError || promptError ? "error" : settings.enabled ? "enabled" : "disabled"}`,
							`Prompt: ${settings.prompt ?? "none"}`,
							`Mode: ${settings.mode}`,
							`Directory: ${paths.prompts}`,
							`Settings: ${paths.settings}`,
							...(configError || overrideError || promptError ? [`Error: ${configError ?? overrideError ?? promptError}`] : []),
						].join("\n"), "info");
						break;
					}
					case "help":
						if (value) throw new Error("Usage: /system-prompt help");
						ctx.ui.notify(HELP, "info");
						break;
					default:
						throw new Error(`Unknown command: ${command}. Run /system-prompt help.`);
				}
			} catch (error) {
				ctx.ui.notify(errorMessage(error), "error");
			}
		},
	});
}
