import assert from "node:assert/strict";
import test from "node:test";
import { getKeybindings, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { PromptViewer } from "../src/viewer.ts";

function fixture(content = Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join("\n")) {
	const terminal = { rows: 10 };
	let renders = 0;
	let closed = 0;
	const tui = { terminal, requestRender: () => { renders++; } } as unknown as TUI;
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const viewer = new PromptViewer(tui, theme, getKeybindings(), "Current Pi system prompt", content, () => { closed++; });
	return { viewer, terminal, renders: () => renders, closed: () => closed };
}

test("the viewer fills the terminal and reaches the entire prompt by line and page", () => {
	const { viewer, renders } = fixture();
	let lines = viewer.render(100);
	assert.equal(lines.length, 10);
	assert.match(lines[1], /^Line 1\s*$/);
	assert.match(lines.at(-1)!, /1-8 of 80/);
	viewer.handleInput("\x1b[B");
	lines = viewer.render(100);
	assert.match(lines[1], /^Line 2\s*$/);
	viewer.handleInput("\x1b[6~");
	lines = viewer.render(100);
	assert.match(lines[1], /^Line 9\s*$/);
	viewer.handleInput("\x1b[5~");
	assert.match(viewer.render(100)[1], /^Line 2\s*$/);
	viewer.handleInput("G");
	lines = viewer.render(100);
	assert.match(lines.at(-2)!, /^Line 80\s*$/);
	assert.match(lines.at(-1)!, /73-80 of 80/);
	viewer.handleInput("j");
	assert.match(viewer.render(100).at(-2)!, /^Line 80\s*$/);
	viewer.handleInput("g");
	assert.match(viewer.render(100)[1], /^Line 1\s*$/);
	assert.ok(renders() > 0);
});

test("the viewer adapts to terminal resizes, narrow widths, and wide characters", () => {
	const { viewer, terminal } = fixture("漢字 café 🙂 text ".repeat(120));
	for (const width of [100, 40, 12, 4, 1]) {
		for (const height of [24, 8, 3, 1]) {
			terminal.rows = height;
			const lines = viewer.render(width);
			assert.equal(lines.length, height);
			assert.ok(lines.every((line) => visibleWidth(line) <= width));
			viewer.handleInput("G");
			viewer.invalidate();
		}
	}
});

test("Escape, q, and Ctrl+C close the viewer without editing the text", () => {
	for (const key of ["\x1b", "q", "\x03"]) {
		const { viewer, closed } = fixture();
		viewer.render(100);
		viewer.handleInput(key);
		assert.equal(closed(), 1);
	}
});

test("empty prompts render safely and terminal control sequences do not reach the screen", () => {
	const empty = fixture("").viewer.render(80);
	assert.equal(empty.length, 10);
	assert.match(empty.at(-1)!, /0-0 of 0/);
	const { viewer } = fixture("First\n\x1b[2JSecond\n# Raw Markdown");
	const rendered = viewer.render(100).join("\n");
	assert.equal(stripTerminalSequences(rendered), rendered);
	assert.match(rendered, /# Raw Markdown/);
});
