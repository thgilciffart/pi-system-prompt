import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { registerPlugin } from "./plugin.ts";

export default async function systemPromptExtension(pi: ExtensionAPI): Promise<void> {
	const agentDir = getAgentDir();
	await registerPlugin(pi, {
		prompts: join(agentDir, "system-prompts"),
		settings: join(agentDir, "system-prompt.json"),
	});
}
