import assert from "node:assert/strict";
import test from "node:test";
import type { BuildSystemPromptOptions, Skill } from "@earendil-works/pi-coding-agent";
import { expandPrompt, promptValues } from "../src/template.ts";

const skill = {
	name: "review", description: "Review <code>", filePath: "/skills/review/SKILL.md", baseDir: "/skills/review",
	disableModelInvocation: false,
} as Skill;

test("templates insert loaded skills and project instructions without expanding inserted placeholders", () => {
	const options: BuildSystemPromptOptions = {
		cwd: "/project/$&", skills: [skill, { ...skill, name: "private", disableModelInvocation: true }],
		contextFiles: [{ path: "/project/AGENTS.md", content: "Keep {{cwd}} literal in this file." }],
	};
	const values = promptValues("Pi {{skills}}", "/unused", options);
	const result = expandPrompt("{{system_prompt}}\n{{ cwd }}\n{{skills}}\n{{project_context}}\n{{unknown}}", values);
	assert.match(result, /^Pi {{skills}}\n\/project\/\$&\n/);
	assert.match(result, /Use the read tool/);
	assert.match(result, /<name>review<\/name>/);
	assert.match(result, /Review &lt;code&gt;/);
	assert.doesNotMatch(result, /<name>private<\/name>/);
	assert.match(result, /<project_instructions path="\/project\/AGENTS.md">\nKeep {{cwd}} literal in this file.\n<\/project_instructions>/);
	assert.match(result, /{{unknown}}$/);
	options.skills![0] = { ...skill, name: "changed" };
	options.contextFiles![0].content = "Changed";
	assert.match(values.skills!, /<name>review<\/name>/);
	assert.doesNotMatch(values.project_context!, /Changed/);
});

test("skills use the available reader and respect tool visibility", () => {
	const values = (selectedTools: string[], hiddenTools: string[] = []) =>
		promptValues("Base", "/project", { cwd: "/project", skills: [skill], selectedTools, hiddenTools });
	assert.match(values(["bash"]).skills!, /Use bash to load/);
	assert.match(values(["read"], ["read"]).skills!, /Load a skill's file/);
	assert.doesNotMatch(values(["read"], ["read"]).skills!, /Use the read tool/);
	assert.equal(values(["write"]).skills, "");
	assert.equal(promptValues("Base", "/project", { cwd: "/project" }).skills, "");
});

test("docs and rules preserve the incoming section contents without the outer tags", () => {
	const base = "Preamble\n\n<rules>\n- Follow tools\n- Keep {{cwd}}\n</rules>\n\n<docs>\nPi docs: /pi/docs\nSee <example>\n</docs>\n\n<cwd>\n/project\n</cwd>";
	const values = promptValues(base, "/project", { cwd: "/project" });
	assert.equal(expandPrompt("{{docs}}\n{{ rules }}", values), "Pi docs: /pi/docs\nSee <example>\n- Follow tools\n- Keep {{cwd}}");
	assert.equal(promptValues("<docs>\r\nDocs\r\n</docs>", "/project").docs, "Docs");
	assert.equal(promptValues("Base", "/project").rules, "");
});

test("explicit section overrides apply to skills and project context", () => {
	const values = promptValues("Base", "/project", {
		cwd: "/project", skills: [skill], sections: { skills: "Custom skills", project_context: "Custom context" },
	});
	assert.equal(expandPrompt("{{skills}}\n{{project_context}}", values), "Custom skills\nCustom context");
});

test("empty expansions fail and hosts without prompt options retain literal prompt support", () => {
	const values = promptValues("Base", "/project", { cwd: "/project" });
	assert.equal(expandPrompt("A{{skills}}{{project_context}}{{docs}}{{rules}}B", values), "AB");
	assert.throws(() => expandPrompt("{{skills}}\n{{project_context}}", values), /empty after expanding/);
	const legacy = promptValues("Base", "/project");
	assert.equal(expandPrompt("Plain Markdown", legacy), "Plain Markdown");
	assert.equal(expandPrompt("{{cwd}}\n{{system_prompt}}", legacy), "/project\nBase");
	assert.throws(() => expandPrompt("{{skills}}", legacy), /requires Pi 1.4 or later/);
});
