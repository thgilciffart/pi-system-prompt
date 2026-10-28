import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
	BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, ExtensionCommandContext,
	ExtensionContext, RegisteredCommand, Theme,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings, type Component, type TUI } from "@earendil-works/pi-tui";
import { registerPlugin } from "../src/plugin.ts";
import { loadSettings, saveSettings, type Paths } from "../src/store.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Command = Omit<RegisteredCommand, "name" | "sourceInfo">;

async function fixture(t: TestContext): Promise<Paths> {
	const root = await mkdtemp(join(tmpdir(), "system-prompt-plugin-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = { prompts: join(root, "system-prompts"), settings: join(root, "system-prompt.json") };
	await mkdir(join(paths.prompts, "review"), { recursive: true });
	await writeFile(join(paths.prompts, "reviewer.md"), "Review carefully.\n");
	await writeFile(join(paths.prompts, "review", "backend.md"), "Review the backend.");
	return paths;
}

async function load(paths: Paths, flags: Record<string, string | undefined> = {}) {
	const handlers = new Map<string, Handler>();
	let command!: Command;
	const notifications: { message: string; type: string | undefined }[] = [];
	const statuses = new Map<string, string>();
	const choices: (string | undefined)[] = [];
	const viewers: { component: Component; options: unknown }[] = [];
	let currentSystemPrompt = "Pi base prompt";
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerFlag: () => {},
		getFlag: (name: string) => flags[name],
		registerCommand: (name: string, options: Command) => {
			assert.equal(name, "system-prompt");
			command = options;
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		mode: "tui",
		getSystemPrompt: () => currentSystemPrompt,
		ui: {
			notify: (message: string, type?: string) => notifications.push({ message, type }),
			setStatus: (key: string, text: string) => statuses.set(key, text),
			select: async () => choices.shift(),
			custom: async (factory: Parameters<ExtensionContext["ui"]["custom"]>[0], options: unknown) => {
				const tui = { terminal: { rows: 12 }, requestRender: () => {} } as unknown as TUI;
				const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
				const component = await factory(tui, theme, getKeybindings() as Parameters<typeof factory>[2], () => {});
				viewers.push({ component, options });
			},
		},
	} as unknown as ExtensionCommandContext;
	await registerPlugin(pi, paths);
	const start = (base?: string) => {
		if (base !== undefined) currentSystemPrompt = base;
		return handlers.get("session_start")!({ type: "session_start" }, ctx);
	};
	const run = async (base = "Pi base prompt"): Promise<BeforeAgentStartEventResult | undefined> => {
		const result = await handlers.get("before_agent_start")!({ systemPrompt: base } as BeforeAgentStartEvent, ctx) as BeforeAgentStartEventResult | undefined;
		currentSystemPrompt = result?.systemPrompt ?? base;
		return result;
	};
	return {
		ctx, notifications, statuses, choices, viewers, start, run,
		command: (args: string) => command.handler(args, ctx),
		complete: (prefix: string) => command.getArgumentCompletions!(prefix),
	};
}

test("selection, mode, disable, and enable persist and compose on the next run", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	await plugin.start();
	assert.equal(await plugin.run(), undefined);
	await plugin.command("use reviewer");
	assert.equal((await plugin.run())?.systemPrompt, "Pi base prompt\n\nReview carefully.\n");
	assert.deepEqual(await loadSettings(paths.settings), { enabled: true, prompt: "reviewer.md", mode: "append" });
	await plugin.command("mode prepend");
	assert.equal((await plugin.run())?.systemPrompt, "Review carefully.\n\n\nPi base prompt");
	await plugin.command("mode replace");
	assert.equal((await plugin.run())?.systemPrompt, "Review carefully.\n");
	await plugin.command("toggle");
	assert.equal(await plugin.run(), undefined);
	assert.equal((await loadSettings(paths.settings)).prompt, "reviewer.md");
	await plugin.command("toggle");
	assert.equal((await plugin.run())?.systemPrompt, "Review carefully.\n");
	assert.match(plugin.statuses.get("system-prompt")!, /reviewer.md \(replace\)/);
	const restarted = await load(paths);
	await restarted.start();
	assert.equal((await restarted.run())?.systemPrompt, "Review carefully.\n");
	assert.equal(plugin.notifications.filter((item) => item.type === "error").length, 0);
});

test("each run rereads the file, preserves earlier extension changes, and avoids accumulation", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	await plugin.command("use reviewer.md");
	assert.equal((await plugin.run("Earlier extension"))?.systemPrompt, "Earlier extension\n\nReview carefully.\n");
	await writeFile(join(paths.prompts, "reviewer.md"), "Updated prompt");
	assert.equal((await plugin.run("Earlier extension"))?.systemPrompt, "Earlier extension\n\nUpdated prompt");
	assert.equal((await plugin.run("Earlier extension"))?.systemPrompt, "Earlier extension\n\nUpdated prompt");
	await plugin.start();
	assert.equal((await plugin.run("New session"))?.systemPrompt, "New session\n\nUpdated prompt");
});

test("missing and empty active files preserve Pi's prompt, report errors, and recover", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	await plugin.command("use reviewer");
	await rm(join(paths.prompts, "reviewer.md"));
	assert.equal(await plugin.run(), undefined);
	assert.equal(plugin.statuses.get("system-prompt"), "system-prompt: error");
	const errorCount = plugin.notifications.filter((item) => item.type === "error").length;
	await plugin.run();
	assert.equal(plugin.notifications.filter((item) => item.type === "error").length, errorCount);
	await plugin.command("status");
	assert.match(plugin.notifications.at(-1)!.message, /State: error/);
	await writeFile(join(paths.prompts, "reviewer.md"), "   \n");
	assert.equal(await plugin.run(), undefined);
	assert.match(plugin.notifications.at(-1)!.message, /empty/);
	await writeFile(join(paths.prompts, "reviewer.md"), "Recovered");
	assert.equal((await plugin.run())?.systemPrompt, "Pi base prompt\n\nRecovered");
	assert.match(plugin.statuses.get("system-prompt")!, /reviewer.md/);
});

test("invalid commands and failed saves do not change the active selection", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	await plugin.command("use reviewer");
	for (const command of ["mode invalid", "use missing", "use ../escape", "toggle extra", "status extra", "unknown", "use", "on", "off"]) {
		await plugin.command(command);
		assert.equal(plugin.notifications.at(-1)!.type, "error");
	}
	await rm(paths.settings);
	await mkdir(paths.settings);
	await plugin.command("mode replace");
	assert.equal(plugin.notifications.at(-1)!.type, "error");
	assert.equal((await plugin.run())?.systemPrompt, "Pi base prompt\n\nReview carefully.\n");
});

test("picker cancellation leaves settings unchanged and names with spaces work", async (t) => {
	const paths = await fixture(t);
	await writeFile(join(paths.prompts, "code review.md"), "With spaces");
	const plugin = await load(paths);
	await plugin.command("");
	assert.equal(await plugin.run(), undefined);
	plugin.choices.push("code review.md");
	await plugin.command("");
	assert.equal((await loadSettings(paths.settings)).prompt, "code review.md");
	await plugin.command("mode");
	assert.equal((await loadSettings(paths.settings)).mode, "append");
	plugin.choices.push("prepend");
	await plugin.command("mode");
	assert.equal((await plugin.run())?.systemPrompt, "With spaces\n\nPi base prompt");
	await plugin.command("use review/backend");
	assert.equal((await loadSettings(paths.settings)).prompt, "review/backend.md");
});

test("listing, status, help, and completions expose prompt names without changing settings", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	await plugin.start();
	await plugin.command("list");
	assert.match(plugin.notifications.at(-1)!.message, /review\/backend.md/);
	await plugin.command("status");
	assert.match(plugin.notifications.at(-1)!.message, /State: disabled\nPrompt: none\nMode: append/);
	await plugin.command("help");
	assert.match(plugin.notifications.at(-1)!.message, /\/system-prompt toggle/);
	assert.deepEqual((await plugin.complete("mo"))?.map((item) => item.value), ["mode"]);
	assert.deepEqual((await plugin.complete("mode re"))?.map((item) => item.value), ["mode replace"]);
	assert.deepEqual((await plugin.complete("use review/"))?.map((item) => item.value), ["use review/backend.md"]);
	assert.deepEqual((await plugin.complete("view review/"))?.map((item) => item.value), ["view review/backend.md"]);
	assert.deepEqual((await plugin.complete("tog"))?.map((item) => item.value), ["toggle"]);
	await assert.rejects(readFile(paths.settings), { code: "ENOENT" });
	await plugin.command("toggle");
	assert.match(plugin.notifications.at(-1)!.message, /No prompt selected/);
});

test("startup flags apply without writes and invalid flags disable the saved prompt", async (t) => {
	const paths = await fixture(t);
	await saveSettings(paths.settings, { enabled: true, prompt: "reviewer.md", mode: "append" });
	const stored = await readFile(paths.settings, "utf8");
	const plugin = await load(paths, { "system-prompt-name": "review/backend", "system-prompt-mode": "replace" });
	await plugin.start();
	assert.equal((await plugin.run())?.systemPrompt, "Review the backend.");
	assert.equal(await readFile(paths.settings, "utf8"), stored);
	for (const flags of [{ "system-prompt-name": "missing" }, { "system-prompt-mode": "wrong" }, { "system-prompt-name": "" }]) {
		const invalid = await load(paths, flags);
		await invalid.start();
		assert.equal(await invalid.run(), undefined);
		await invalid.command("status");
		assert.match(invalid.notifications.at(-1)!.message, /State: error/);
		assert.equal(await readFile(paths.settings, "utf8"), stored);
		await invalid.command("toggle");
		assert.equal((await invalid.run())?.systemPrompt, "Pi base prompt\n\nReview carefully.\n");
	}
});

test("invalid saved settings remain untouched and the error appears in status", async (t) => {
	const paths = await fixture(t);
	await writeFile(paths.settings, "{invalid");
	const plugin = await load(paths);
	await plugin.start();
	assert.equal(await plugin.run(), undefined);
	await plugin.command("status");
	assert.match(plugin.notifications.at(-1)!.message, /State: error/);
	for (const command of ["use reviewer", "mode replace", "toggle"]) {
		await plugin.command(command);
		assert.equal(plugin.notifications.at(-1)!.type, "error");
		assert.equal(await readFile(paths.settings, "utf8"), "{invalid");
	}
});

test("explicit commands and startup overrides work without dialogs", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths, { "system-prompt-name": "reviewer", "system-prompt-mode": "prepend" });
	plugin.ctx.hasUI = false;
	plugin.ctx.ui.select = async () => { throw new Error("Must not open a dialog"); };
	await plugin.start();
	assert.equal((await plugin.run())?.systemPrompt, "Review carefully.\n\n\nPi base prompt");
	await plugin.command("");
	assert.match(plugin.notifications.at(-1)!.message, /dialogs are unavailable/);
	await plugin.command("mode");
	assert.equal(plugin.notifications.at(-1)!.type, "error");
	await plugin.command("use review/backend");
	assert.equal((await plugin.run())?.systemPrompt, "Review the backend.\n\nPi base prompt");
});

test("view previews current settings before a run and avoids duplicate composition", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	await plugin.command("view");
	assert.match(plugin.viewers.at(-1)!.component.render(100).join("\n"), /System prompt preview[\s\S]*Pi base prompt/);
	await plugin.command("use reviewer");
	const stored = await readFile(paths.settings, "utf8");
	await plugin.command("view");
	const view = plugin.viewers.at(-1)!;
	const rendered = view.component.render(100).join("\n");
	assert.match(rendered, /Pi base prompt[\s\S]*Review carefully/);
	assert.equal(rendered.split("Review carefully").length - 1, 1);
	assert.deepEqual(view.options, {
		overlay: true,
		overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 },
	});
	await plugin.run();
	await plugin.command("view");
	assert.equal(plugin.viewers.at(-1)!.component.render(100).join("\n").split("Review carefully").length - 1, 1);
	await plugin.command("mode replace");
	await plugin.command("view");
	assert.doesNotMatch(plugin.viewers.at(-1)!.component.render(100).join("\n"), /Pi base prompt/);
	await plugin.run();
	await plugin.command("view");
	assert.doesNotMatch(plugin.viewers.at(-1)!.component.render(100).join("\n"), /Pi base prompt/);
	assert.equal((await loadSettings(paths.settings)).prompt, JSON.parse(stored).prompt);
});

test("view rereads files and reflects mode, selection, toggle, and session changes", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	const view = async () => {
		await plugin.command("view");
		return plugin.viewers.at(-1)!.component.render(100).join("\n");
	};
	await plugin.command("use reviewer");
	await plugin.run("Earlier extension");
	await writeFile(join(paths.prompts, "reviewer.md"), "Edited prompt");
	assert.match(await view(), /Earlier extension[\s\S]*Edited prompt/);
	await plugin.command("mode prepend");
	assert.match(await view(), /Edited prompt[\s\S]*Earlier extension/);
	await plugin.command("mode replace");
	await plugin.run();
	await plugin.command("use review/backend");
	assert.match(await view(), /Review the backend/);
	assert.doesNotMatch(await view(), /Edited prompt/);
	await plugin.command("toggle");
	assert.match(await view(), /Pi base prompt/);
	assert.doesNotMatch(await view(), /Review the backend/);
	await plugin.command("toggle");
	await rm(join(paths.prompts, "review", "backend.md"));
	const count = plugin.viewers.length;
	await plugin.command("view");
	assert.equal(plugin.viewers.length, count);
	assert.equal(plugin.notifications.at(-1)!.type, "error");
	await plugin.command("toggle");
	await plugin.run("Previous session");
	await plugin.start("New session");
	assert.match(await view(), /New session/);
	assert.doesNotMatch(await view(), /Previous session/);
});

test("viewing a named file does not select it or save settings", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	await plugin.command("view review/backend");
	const rendered = plugin.viewers.at(-1)!.component.render(100).join("\n");
	assert.match(rendered, /Prompt file: review\/backend.md/);
	assert.match(rendered, /Review the backend/);
	await assert.rejects(readFile(paths.settings), { code: "ENOENT" });
	assert.equal(await plugin.run(), undefined);
	await plugin.command("view missing");
	assert.equal(plugin.notifications.at(-1)!.type, "error");
});

test("the full-screen viewer rejects RPC and print modes before opening custom UI", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	for (const mode of ["rpc", "print", "json"] as const) {
		plugin.ctx.mode = mode;
		await plugin.command("view");
		assert.match(plugin.notifications.at(-1)!.message, /requires Pi's interactive terminal mode/);
	}
	assert.equal(plugin.viewers.length, 0);
});
