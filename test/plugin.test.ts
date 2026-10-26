import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
	BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, ExtensionCommandContext,
	ExtensionContext, RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { registerPlugin } from "../src/plugin.ts";
import { loadSettings, saveSettings, type Paths } from "../src/store.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Command = Omit<RegisteredCommand, "name" | "sourceInfo">;

async function fixture(t: TestContext): Promise<Paths> {
	const root = await mkdtemp(join(tmpdir(), "pi-sys-prompt-plugin-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = { prompts: join(root, "system-prompts"), settings: join(root, "pi-sys-prompt.json") };
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
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerFlag: () => {},
		getFlag: (name: string) => flags[name],
		registerCommand: (name: string, options: Command) => {
			assert.equal(name, "sys-prompt");
			command = options;
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			notify: (message: string, type?: string) => notifications.push({ message, type }),
			setStatus: (key: string, text: string) => statuses.set(key, text),
			select: async () => choices.shift(),
		},
	} as unknown as ExtensionCommandContext;
	await registerPlugin(pi, paths);
	const start = () => handlers.get("session_start")!({ type: "session_start" }, ctx);
	const run = async (base = "Pi base prompt"): Promise<BeforeAgentStartEventResult | undefined> =>
		await handlers.get("before_agent_start")!({ systemPrompt: base } as BeforeAgentStartEvent, ctx) as BeforeAgentStartEventResult | undefined;
	return {
		ctx, notifications, statuses, choices, start, run,
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
	await plugin.command("off");
	assert.equal(await plugin.run(), undefined);
	assert.equal((await loadSettings(paths.settings)).prompt, "reviewer.md");
	await plugin.command("on");
	assert.equal((await plugin.run())?.systemPrompt, "Review carefully.\n");
	assert.match(plugin.statuses.get("pi-sys-prompt")!, /reviewer.md \(replace\)/);
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
	assert.equal(plugin.statuses.get("pi-sys-prompt"), "sys-prompt: error");
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
	assert.match(plugin.statuses.get("pi-sys-prompt")!, /reviewer.md/);
});

test("invalid commands and failed saves do not change the active selection", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths);
	await plugin.command("use reviewer");
	for (const command of ["mode invalid", "use missing", "use ../escape", "on extra", "status extra", "unknown", "use"]) {
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
	assert.match(plugin.notifications.at(-1)!.message, /\/sys-prompt off/);
	assert.deepEqual((await plugin.complete("mo"))?.map((item) => item.value), ["mode"]);
	assert.deepEqual((await plugin.complete("mode re"))?.map((item) => item.value), ["mode replace"]);
	assert.deepEqual((await plugin.complete("use review/"))?.map((item) => item.value), ["use review/backend.md"]);
	await assert.rejects(readFile(paths.settings), { code: "ENOENT" });
	await plugin.command("on");
	assert.match(plugin.notifications.at(-1)!.message, /No prompt selected/);
});

test("startup flags apply without writes and invalid flags disable the saved prompt", async (t) => {
	const paths = await fixture(t);
	await saveSettings(paths.settings, { enabled: true, prompt: "reviewer.md", mode: "append" });
	const stored = await readFile(paths.settings, "utf8");
	const plugin = await load(paths, { "sys-prompt": "review/backend", "sys-prompt-mode": "replace" });
	await plugin.start();
	assert.equal((await plugin.run())?.systemPrompt, "Review the backend.");
	assert.equal(await readFile(paths.settings, "utf8"), stored);
	for (const flags of [{ "sys-prompt": "missing" }, { "sys-prompt-mode": "wrong" }, { "sys-prompt": "" }]) {
		const invalid = await load(paths, flags);
		await invalid.start();
		assert.equal(await invalid.run(), undefined);
		await invalid.command("status");
		assert.match(invalid.notifications.at(-1)!.message, /State: error/);
		assert.equal(await readFile(paths.settings, "utf8"), stored);
		await invalid.command("on");
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
	for (const command of ["use reviewer", "mode replace", "off"]) {
		await plugin.command(command);
		assert.equal(plugin.notifications.at(-1)!.type, "error");
		assert.equal(await readFile(paths.settings, "utf8"), "{invalid");
	}
});

test("explicit commands and startup overrides work without dialogs", async (t) => {
	const paths = await fixture(t);
	const plugin = await load(paths, { "sys-prompt": "reviewer", "sys-prompt-mode": "prepend" });
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
