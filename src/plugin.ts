import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	composePrompt, defaultSettings, isMode, listPrompts, loadSettings, MODES,
	readPrompt, resolvePrompt, saveSettings, type Paths, type Settings,
} from "./store.ts";

const HELP = [
	"/sys-prompt                 Choose a prompt",
	"/sys-prompt use <name>      Select and enable a prompt",
	"/sys-prompt mode <mode>     Set prepend, append, or replace",
	"/sys-prompt mode            Choose a mode",
	"/sys-prompt list            List Markdown files",
	"/sys-prompt status          Show settings and file health",
	"/sys-prompt off             Disable the selected prompt",
	"/sys-prompt on              Enable the selected prompt",
	"/sys-prompt help            Show these commands",
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

	pi.registerFlag("sys-prompt", { type: "string", description: "Select a system prompt for this Pi process" });
	pi.registerFlag("sys-prompt-mode", { type: "string", description: "System prompt mode: prepend, append, or replace" });

	function updateFooter(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const status = configError || overrideError || promptError ? "sys-prompt: error" : settings.enabled && settings.prompt
			? `sys-prompt: ${settings.prompt} (${settings.mode})` : "sys-prompt: off";
		ctx.ui.setStatus("pi-sys-prompt", status);
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
				if (!selected.prompt) throw new Error("No prompt selected. Run /sys-prompt use <name>.");
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
					const name = pi.getFlag("sys-prompt");
					const mode = pi.getFlag("sys-prompt-mode");
					const next = { ...settings };
					if (typeof mode === "string") {
						if (!isMode(mode)) throw new Error("--sys-prompt-mode must be prepend, append, or replace.");
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
					warn(ctx, `pi-sys-prompt: ${overrideError} Custom prompt disabled.`);
					updateFooter(ctx);
					return;
				}
			}
		}
		if (configError) warn(ctx, configError);
		else {
			await checkPrompt();
			if (promptError) warn(ctx, `pi-sys-prompt: ${promptError} Keeping Pi's incoming system prompt.`);
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
			warn(ctx, `pi-sys-prompt: ${error} Keeping Pi's incoming system prompt.`);
			return;
		}
		lastWarning = undefined;
		if (custom !== undefined) return { systemPrompt: composePrompt(event.systemPrompt, custom, selected.mode) };
	});

	pi.registerCommand("sys-prompt", {
		description: "Choose, list, or disable Markdown system prompts",
		getArgumentCompletions: async (prefix) => {
			const commands = ["use", "mode", "list", "status", "off", "on", "help"];
			if (prefix.startsWith("mode ")) {
				return MODES.map((mode) => ({ value: `mode ${mode}`, label: mode })).filter((item) => item.value.startsWith(prefix));
			}
			if (prefix.startsWith("use ")) {
				try {
					return (await listPrompts(paths.prompts)).map((id) => ({ value: `use ${id}`, label: id }))
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
						if (!ctx.hasUI) throw new Error("Use /sys-prompt use <name> when dialogs are unavailable.");
						const prompts = await listPrompts(paths.prompts);
						if (!prompts.length) throw new Error(`No Markdown prompts found. Add a .md file to ${paths.prompts}.`);
						const selected = await ctx.ui.select("Choose a system prompt", prompts);
						if (selected !== undefined) await usePrompt(selected, ctx);
						break;
					}
					case "use":
						if (!value) throw new Error("Usage: /sys-prompt use <name>");
						await usePrompt(value, ctx);
						break;
					case "mode": {
						if (!value && !ctx.hasUI) throw new Error("Usage: /sys-prompt mode <prepend|append|replace>");
						const mode = value || await ctx.ui.select("Choose a system prompt mode", [...MODES]);
						if (mode === undefined) break;
						if (!isMode(mode)) throw new Error("Mode must be prepend, append, or replace.");
						await commit({ ...settings, mode }, ctx);
						break;
					}
					case "off":
					case "on":
						if (value) throw new Error(`Usage: /sys-prompt ${command}`);
						if (command === "on") {
							if (!settings.prompt) throw new Error("No prompt selected. Run /sys-prompt use <name>.");
							await readPrompt(paths.prompts, settings.prompt);
						}
						await commit({ ...settings, enabled: command === "on" }, ctx);
						break;
					case "list": {
						if (value) throw new Error("Usage: /sys-prompt list");
						const prompts = await listPrompts(paths.prompts);
						ctx.ui.notify(prompts.length
							? `System prompts in ${paths.prompts}:\n${prompts.map((id) => `${id === settings.prompt ? "* " : "  "}${id}`).join("\n")}`
							: `No Markdown prompts found. Add a .md file to ${paths.prompts}.`, "info");
						break;
					}
					case "status": {
						if (value) throw new Error("Usage: /sys-prompt status");
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
						if (value) throw new Error("Usage: /sys-prompt help");
						ctx.ui.notify(HELP, "info");
						break;
					default:
						throw new Error(`Unknown command: ${command}. Run /sys-prompt help.`);
				}
			} catch (error) {
				ctx.ui.notify(errorMessage(error), "error");
			}
		},
	});
}
