import { formatSkillsForPrompt, type BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

export interface PromptValues {
	system_prompt: string;
	cwd: string;
	skills: string | undefined;
	project_context: string | undefined;
	docs: string;
	rules: string;
}

function sectionContent(prompt: string, name: "docs" | "rules"): string {
	return new RegExp(`(?:^|\\n)<${name}>\\r?\\n([\\s\\S]*?)\\r?\\n</${name}>(?=\\r?\\n|$)`).exec(prompt)?.[1] ?? "";
}

/** Capture strings before later extensions can mutate the prompt options. */
export function promptValues(systemPrompt: string, cwd: string, options?: BuildSystemPromptOptions): PromptValues {
	let skills: string | undefined;
	let projectContext: string | undefined;
	if (options) {
		const selectedTools = options.selectedTools ?? ["read", "bash", "edit", "write"];
		const readers = ["read", "bash"] as const;
		const reader = readers.find((name) => selectedTools.includes(name) && !options.hiddenTools?.includes(name)) ??
			(readers.some((name) => selectedTools.includes(name)) ? "indirect" : undefined);
		skills = options.sections?.skills || (reader ? formatSkillsForPrompt(options.skills ?? [], reader).trim() : "");
		const files = options.contextFiles ?? [];
		projectContext = options.sections?.project_context || (files.length ? [
			"Project-specific instructions and guidelines:",
			...files.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
		].join("\n\n") : "");
	}
	return {
		system_prompt: systemPrompt, cwd: options?.cwd ?? cwd, skills, project_context: projectContext,
		docs: sectionContent(systemPrompt, "docs"), rules: sectionContent(systemPrompt, "rules"),
	};
}

/** Expand only known placeholders in the file, never placeholders inside inserted values. */
export function expandPrompt(source: string, values: PromptValues): string {
	const expanded = source.replace(/{{[ \t]*(system_prompt|cwd|skills|project_context|docs|rules)[ \t]*}}/g, (_match, name: keyof PromptValues) => {
		const value = values[name];
		if (value === undefined) throw new Error(`The {{${name}}} placeholder requires Pi 1.4 or later. Update Pi, then run /reload.`);
		return value;
	});
	if (!expanded.trim()) throw new Error("Prompt is empty after expanding placeholders.");
	return expanded;
}
