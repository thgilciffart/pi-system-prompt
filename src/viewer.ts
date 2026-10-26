import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Key, matchesKey, ScrollView, stripTerminalSequences, Text, truncateToWidth,
	type Component, type KeybindingsManager, type TUI, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export class PromptViewer implements Component {
	private readonly text: Text;
	private readonly scroll: ScrollView;

	constructor(
		private readonly tui: Pick<TUI, "terminal" | "requestRender">,
		private readonly theme: Pick<Theme, "fg" | "bold">,
		private readonly keybindings: Pick<KeybindingsManager, "matches">,
		private readonly title: string,
		content: string,
		private readonly done: () => void,
	) {
		this.text = new Text(stripTerminalSequences(content), 0, 0);
		this.scroll = new ScrollView(this.text);
	}

	render(width: number): string[] {
		width = Math.max(1, width);
		const height = Math.max(1, this.tui.terminal.rows);
		const bodyHeight = Math.max(0, height - 2);
		const lines = this.text.render(width);
		this.scroll.updateLayout(lines.length, bodyHeight, () => this.tui.requestRender());
		const body = lines.slice(this.scroll.scrollTop, this.scroll.scrollTop + bodyHeight);
		while (body.length < bodyHeight) body.push("");
		const first = lines.length && bodyHeight ? this.scroll.scrollTop + 1 : 0;
		const last = Math.min(lines.length, this.scroll.scrollTop + bodyHeight);
		const footer = `Esc close | ${first}-${last} of ${lines.length} | Up/Down scroll | PgUp/PgDn page | Home/End`;
		return [
			this.theme.fg("accent", this.theme.bold(stripTerminalSequences(this.title))),
			...body,
			this.theme.fg("dim", footer),
		].slice(0, height).map((line) => truncateToWidth(line, width, "", true));
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape) ||
			matchesKey(data, Key.ctrl("c")) || data === "q") {
			this.done();
		} else if (this.keybindings.matches(data, "tui.select.up") || matchesKey(data, Key.up) || data === "k") {
			this.scroll.scrollBy(-1);
		} else if (this.keybindings.matches(data, "tui.select.down") || matchesKey(data, Key.down) || data === "j") {
			this.scroll.scrollBy(1);
		} else if (matchesKey(data, Key.pageUp)) {
			this.scroll.scrollBy(-Math.max(1, this.scroll.viewportHeight - 1));
		} else if (matchesKey(data, Key.pageDown) || data === " ") {
			this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight - 1));
		} else if (matchesKey(data, Key.home) || data === "g") {
			this.scroll.scrollToStart();
		} else if (matchesKey(data, Key.end) || data === "G") {
			this.scroll.scrollToEnd();
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel") return undefined;
		this.scroll.scrollBy(event.wheelDelta ?? 0);
		return { handled: true };
	}

	invalidate(): void {
		this.text.invalidate();
	}
}
