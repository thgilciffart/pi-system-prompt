import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MODES = ["prepend", "append", "replace"] as const;
export type Mode = (typeof MODES)[number];

export interface Settings {
	enabled: boolean;
	prompt: string | null;
	mode: Mode;
}

export interface Paths {
	prompts: string;
	settings: string;
}

export function defaultSettings(): Settings {
	return { enabled: false, prompt: null, mode: "append" };
}

export function isMode(value: unknown): value is Mode {
	return MODES.some((mode) => mode === value);
}

function isMissing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function validPromptId(id: string): boolean {
	return !isAbsolute(id) && !id.includes("\\") && !id.includes("\0") &&
		id.split("/").every((part) => part !== "" && part !== "." && part !== "..") && /\.md$/i.test(id);
}

export async function loadSettings(file: string): Promise<Settings> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch (error) {
		if (isMissing(error)) return defaultSettings();
		throw error;
	}
	const value: unknown = JSON.parse(raw);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Settings must be a JSON object.");
	}
	const settings = value as Record<string, unknown>;
	if (typeof settings.enabled !== "boolean" || !isMode(settings.mode) ||
		!(settings.prompt === null || (typeof settings.prompt === "string" && validPromptId(settings.prompt)))) {
		throw new Error("Settings require enabled, prompt, and mode. See docs/reference.md.");
	}
	return { enabled: settings.enabled, prompt: settings.prompt, mode: settings.mode };
}

export async function saveSettings(file: string, settings: Settings): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(settings, null, "\t")}\n`, { mode: 0o600, flag: "wx" });
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function listPrompts(directory: string): Promise<string[]> {
	const prompts: string[] = [];
	async function visit(folder: string, prefix: string): Promise<void> {
		const entries = await readdir(folder, { withFileTypes: true });
		for (const entry of entries) {
			const id = prefix + entry.name;
			if (entry.isDirectory()) await visit(join(folder, entry.name), `${id}/`);
			else if (entry.isFile() && /\.md$/i.test(entry.name)) prompts.push(id);
		}
	}
	try {
		await visit(directory, "");
	} catch (error) {
		// A missing root is an empty library. Errors in existing libraries remain visible.
		if (isMissing(error)) {
			try {
				await lstat(directory);
			} catch (rootError) {
				if (isMissing(rootError)) return [];
				throw rootError;
			}
		}
		throw error;
	}
	return prompts.sort((a, b) => a.localeCompare(b, "en"));
}

export async function resolvePrompt(directory: string, name: string): Promise<string> {
	const prompts = await listPrompts(directory);
	if (prompts.includes(name)) return name;
	const matches = prompts.filter((id) => id.replace(/\.md$/i, "") === name);
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) throw new Error(`Prompt name is ambiguous: ${name}. Include the file extension.`);
	throw new Error(`Prompt not found: ${name}. Run /sys-prompt list.`);
}

export async function readPrompt(directory: string, id: string): Promise<string> {
	if (!validPromptId(id)) throw new Error(`Invalid prompt path: ${id}`);
	const file = resolve(directory, ...id.split("/"));
	const [root, target, info] = await Promise.all([realpath(directory), realpath(file), lstat(file)]);
	const pathFromRoot = relative(root, target);
	if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot) || !info.isFile()) {
		throw new Error(`Prompt must be a regular Markdown file inside ${directory}.`);
	}
	const content = await readFile(file, "utf8");
	if (!content.trim()) throw new Error(`Prompt is empty: ${id}`);
	return content;
}

export function composePrompt(base: string, custom: string, mode: Mode): string {
	if (mode === "replace" || !base) return custom;
	return mode === "prepend" ? `${custom}\n\n${base}` : `${base}\n\n${custom}`;
}
