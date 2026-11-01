import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

test("Pi discovers the package manifest, loads TypeScript, and applies startup flags", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "system-prompt-host-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	t.after(async () => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(root, { recursive: true, force: true });
	});
	const { discoverAndLoadExtensions, ExtensionRunner, SessionManager } = await import("@earendil-works/pi-coding-agent");
	const packageRoot = fileURLToPath(new URL("../", import.meta.url));
	const loaded = await discoverAndLoadExtensions([packageRoot], root, root);
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	const extension = loaded.extensions[0];
	assert.ok(extension.commands.has("system-prompt"));
	await mkdir(join(root, "system-prompts"));
	await writeFile(join(root, "system-prompts", "smoke.md"), "Host smoke prompt");
	loaded.runtime.flagValues.set("system-prompt-name", "smoke");
	loaded.runtime.flagValues.set("system-prompt-mode", "replace");
	const statuses: string[] = [];
	const ctx = {
		hasUI: true,
		ui: {
			notify: (message: string) => assert.fail(message),
			setStatus: (_key: string, value: string) => statuses.push(value),
		},
	} as unknown as ExtensionContext;
	for (const handler of extension.handlers.get("session_start")!) await handler({ type: "session_start" }, ctx);
	const [handler] = extension.handlers.get("before_agent_start")!;
	assert.deepEqual(await handler({ systemPrompt: "Host base" }, ctx), { systemPrompt: "Host smoke prompt" });
	assert.equal(statuses.at(-1), "system-prompt: smoke.md (replace)");

	// Render real Pi sections through its extension runner, without a model request.
	await writeFile(join(root, "system-prompts", "smoke.md"), "Custom {{cwd}}\n{{rules}}\n{{docs}}\n{{skills}}\n{{project_context}}");
	const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, SessionManager.inMemory(root), {} as ConstructorParameters<typeof ExtensionRunner>[4]);
	const result = await runner.emitBeforeAgentStart({ messageType: "user", prompt: "Test" }, {
		cwd: root,
		selectedTools: ["read", "bash"],
		promptGuidelines: ["Keep the host rule"],
		contextFiles: [{ path: join(root, "AGENTS.md"), content: "Host project context" }],
		skills: [{
			name: "host-skill", description: "Host skill description", filePath: join(root, "skills", "SKILL.md"),
			baseDir: join(root, "skills"), disableModelInvocation: false,
			sourceInfo: { path: join(root, "skills", "SKILL.md"), origin: "top-level", scope: "user", source: "test" },
		}],
	});
	const expanded = result.systemPromptOptions.forceSystemPrompt!;
	assert.ok(expanded.startsWith(`Custom ${root}\n`));
	assert.match(expanded, /- Keep the host rule/);
	assert.match(expanded, /Pi documentation[\s\S]*Main documentation:/);
	assert.match(expanded, /<name>host-skill<\/name>/);
	assert.match(expanded, /Host project context/);
	assert.doesNotMatch(expanded, /{{(?:cwd|rules|docs|skills|project_context)}}/);
});
