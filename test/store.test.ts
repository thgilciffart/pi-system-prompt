import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { composePrompt, defaultSettings, listPrompts, loadSettings, readPrompt, resolvePrompt, saveSettings } from "../src/store.ts";

async function fixture(t: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-sys-prompt-store-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test("discovery finds nested Markdown files and ignores other files and symlinks", async (t) => {
	const root = await fixture(t);
	const prompts = join(root, "prompts");
	await mkdir(join(prompts, "review"), { recursive: true });
	await Promise.all([
		writeFile(join(prompts, "general.md"), "General"),
		writeFile(join(prompts, "review", "backend.MD"), "Backend"),
		writeFile(join(prompts, ".hidden.md"), "Hidden"),
		writeFile(join(prompts, "notes.txt"), "Ignored"),
	]);
	// Windows CI does not require Developer Mode or symlink privileges.
	if (process.platform !== "win32") {
		await symlink(join(prompts, "general.md"), join(prompts, "linked.md"));
		await symlink(prompts, join(prompts, "loop"), "dir");
	}
	assert.deepEqual(await listPrompts(prompts), [".hidden.md", "general.md", "review/backend.MD"]);
	assert.deepEqual(await listPrompts(join(root, "missing")), []);
	await assert.rejects(listPrompts(join(prompts, "notes.txt")), { code: "ENOTDIR" });
	assert.equal(await resolvePrompt(prompts, "review/backend"), "review/backend.MD");
	assert.equal(await resolvePrompt(prompts, "general.md"), "general.md");
	await assert.rejects(resolvePrompt(prompts, "backend"), /not found/);
	await assert.rejects(resolvePrompt(prompts, "../outside"), /not found/);
});

test("reading preserves all Markdown and rejects empty or escaping paths", async (t) => {
	const root = await fixture(t);
	const prompts = join(root, "prompts");
	await mkdir(prompts);
	const content = "---\ndescription: Keep this\n---\n\n# Prompt\n\nDo the work.\n";
	await writeFile(join(prompts, "code review.md"), content);
	await writeFile(join(prompts, "empty.md"), " \n\t");
	await writeFile(join(root, "outside.md"), "Outside");
	assert.equal(await readPrompt(prompts, "code review.md"), content);
	await assert.rejects(readPrompt(prompts, "empty.md"), /empty/);
	await assert.rejects(readPrompt(prompts, "missing.md"), { code: "ENOENT" });
	for (const id of ["../outside.md", "/outside.md", "a/../../outside.md", "a\\b.md", "file.txt", "./code review.md"]) {
		await assert.rejects(readPrompt(prompts, id), /Invalid prompt path/);
	}
	if (process.platform !== "win32") {
		await symlink(join(root, "outside.md"), join(prompts, "escape.md"));
		await symlink(root, join(prompts, "escape-dir"), "dir");
		await assert.rejects(readPrompt(prompts, "escape.md"), /regular Markdown file/);
		await assert.rejects(readPrompt(prompts, "escape-dir/outside.md"), /regular Markdown file/);
	}
});

test("settings default to disabled, round-trip atomically, and reject malformed data", async (t) => {
	const root = await fixture(t);
	const file = join(root, "agent", "pi-sys-prompt.json");
	assert.deepEqual(await loadSettings(file), defaultSettings());
	const settings = { enabled: true, prompt: "review/backend.md", mode: "prepend" } as const;
	await saveSettings(file, settings);
	assert.deepEqual(await loadSettings(file), settings);
	assert.deepEqual(await readdir(join(root, "agent")), ["pi-sys-prompt.json"]);
	if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
	for (const content of ["{", "null", "[]", "{}", '{"enabled":"yes","prompt":null,"mode":"append"}',
		'{"enabled":true,"prompt":"../escape.md","mode":"append"}',
		'{"enabled":true,"prompt":"ok.md","mode":"invalid"}']) {
		await writeFile(file, content);
		await assert.rejects(loadSettings(file));
		assert.equal(await readFile(file, "utf8"), content);
	}
});

test("a failed settings rename leaves no temporary file", async (t) => {
	const root = await fixture(t);
	const directory = join(root, "pi-sys-prompt.json");
	await mkdir(directory);
	await assert.rejects(saveSettings(directory, defaultSettings()));
	assert.deepEqual(await readdir(root), ["pi-sys-prompt.json"]);
});

test("composition preserves exact file content and inserts only the separator", () => {
	assert.equal(composePrompt("Base", "Custom\n", "prepend"), "Custom\n\n\nBase");
	assert.equal(composePrompt("Base", "Custom\n", "append"), "Base\n\nCustom\n");
	assert.equal(composePrompt("Base", "Custom\n", "replace"), "Custom\n");
	for (const mode of ["prepend", "append", "replace"] as const) {
		assert.equal(composePrompt("", "Custom\n", mode), "Custom\n");
	}
});
