// @vitest-environment happy-dom
// Spike regression: what the editor serializes right after load (the save baseline) must have
// the same top-level block structure as the original, or source-preserving save cannot work.
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { splitBlocks, spliceMarkdown, splitFrontmatter } from "../src/md/splice";
import { planSave } from "../src/md/viewer-state";

// KaTeX checks the doctype once at module load and refuses to render in quirks mode;
// happy-dom starts without a doctype, so set it before Crepe (and KaTeX) are imported.
Object.defineProperty(document, "compatMode", { value: "CSS1Compat", configurable: true });

const samples = [
  "AGENTS.md",
  "docs/superpowers/specs/2026-10-26-view-anything-design.md",
  "tests/fixtures/sample.md",
];

async function editorBaseline(md: string): Promise<string> {
  const { createEditor } = await import("../src/md/editor");
  const root = document.createElement("div");
  document.body.append(root);
  const editor = await createEditor(root, md);
  const out = editor.getMarkdown();
  editor.destroy();
  root.remove();
  return out;
}

for (const file of samples) {
  test(`editor baseline keeps block structure: ${file}`, async () => {
    const original = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const { body } = splitFrontmatter(original);
    const baseline = await editorBaseline(body);
    expect(splitBlocks(baseline).map((b) => b.kind)).toEqual(splitBlocks(body).map((b) => b.kind));
    // Same structure means splicing works: an unchanged editor writes nothing.
    expect(spliceMarkdown(body, baseline, baseline)).toBeNull();
    expect(planSave(original, baseline, baseline)).toEqual({ kind: "unchanged" });
  }, 20000);
}

test("editing one block of the fixture changes only that block", async () => {
  const original = readFileSync("tests/fixtures/sample.md", "utf8").replace(/\r\n/g, "\n");
  const baseline = await editorBaseline(splitFrontmatter(original).body);
  const edited = baseline.replace("> 인용문 예시", "> 고친 인용문");
  expect(edited).not.toBe(baseline);
  expect(planSave(original, baseline, edited)).toEqual({
    kind: "splice",
    text: original.replace("> 인용문 예시", "> 고친 인용문"),
  });
}, 20000);
