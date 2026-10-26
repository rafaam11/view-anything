// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { attachCodePreviewSwitch } from "../src/md/code-preview";

/** Mimics Crepe's code block DOM: the toggle button flips `hidden` on the CodeMirror host. */
function fakeBlock(previewing = true) {
  const block = document.createElement("div");
  block.className = "milkdown-code-block";
  block.innerHTML =
    '<div class="tools"><button class="preview-toggle-button"></button></div>' +
    '<div class="codemirror-host"><div class="cm-content" tabindex="0"></div></div>' +
    '<div class="preview-panel"><div class="preview"><svg></svg></div></div>';
  const host = block.querySelector<HTMLElement>(".codemirror-host")!;
  host.classList.toggle("hidden", previewing);
  block.querySelector("button")!.addEventListener("click", () => host.classList.toggle("hidden"));
  return { block, host, cm: block.querySelector<HTMLElement>(".cm-content")!, preview: block.querySelector<HTMLElement>(".preview")! };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  document.body.replaceChildren();
});

function setup() {
  const root = document.createElement("div");
  const outside = document.createElement("p");
  outside.tabIndex = 0;
  const b = fakeBlock();
  root.append(b.block, outside);
  document.body.append(root);
  const sw = attachCodePreviewSwitch(root);
  cleanup = sw.dispose;
  return { ...b, outside, sw };
}

test("clicking a rendered preview reveals and focuses the source", async () => {
  const { host, cm, preview } = setup();
  preview.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await tick();
  expect(host.classList.contains("hidden")).toBe(false);
  expect(document.activeElement).toBe(cm);
});

test("focus leaving the block shows the preview again", async () => {
  const { host, cm, outside, sw } = setup();
  await sw.reveal(host.parentElement!);
  expect(document.activeElement).toBe(cm);
  outside.focus();
  await tick();
  expect(host.classList.contains("hidden")).toBe(true);
});

test("focus moving within the block keeps the source", async () => {
  const { host, block, sw } = setup();
  await sw.reveal(block);
  block.querySelector<HTMLElement>("button")!.focus();
  await tick();
  expect(host.classList.contains("hidden")).toBe(false);
});

test("reveal is a no-op for blocks without a preview", async () => {
  const root = document.createElement("div");
  const block = document.createElement("div");
  block.className = "milkdown-code-block";
  block.innerHTML = '<div class="codemirror-host"><div class="cm-content" tabindex="0"></div></div>';
  root.append(block);
  document.body.append(root);
  const sw = attachCodePreviewSwitch(root);
  cleanup = sw.dispose;
  await sw.reveal(block);
  expect(block.querySelector(".codemirror-host")!.classList.contains("hidden")).toBe(false);
});

test("a preview appearing while typing in the block does not hide the source", async () => {
  // A new mermaid block has no preview until it has content; Crepe then switches it to
  // preview-only, which would yank the source away from the cursor.
  const { host, cm, sw } = setup();
  await sw.reveal(host.parentElement!);
  host.classList.add("hidden");
  await tick();
  expect(host.classList.contains("hidden")).toBe(false);
  expect(document.activeElement).toBe(cm);
});
