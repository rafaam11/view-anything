import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : [],
  );
}
/** Splits a selector list on the commas outside parentheses (`:where(a, b)` stays whole). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}
/** Top-level and @media-nested rules as { selectors, body }. */
function rules(source: string): { selectors: string[]; body: string }[] {
  const out: { selectors: string[]; body: string }[] = [];
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) out.push({ selectors: splitSelectors(m[1]), body: m[2] });
  return out;
}

const base = readFileSync("src/ui/base.css", "utf8");

test("the baseline for bare elements has zero specificity", () => {
  for (const r of rules(base)) {
    for (const s of r.selectors) {
      if (/(^|[\s>+~(,])(button|input|select|textarea)\b/.test(s) && !s.startsWith(".")) {
        expect(s.startsWith(":where("), s).toBe(true);
      }
    }
  }
});

test("the baseline leaves the Markdown editor's own controls alone", () => {
  const baseline = rules(base).flatMap((r) => r.selectors).filter((s) => /^:where\((button|input)/.test(s));
  expect(baseline.length).toBeGreaterThan(3);
  for (const s of baseline.filter((s) => !s.includes("focus-visible"))) expect(s, s).toContain(":not(:where(.md-editor *))");
});

// Special widgets that draw their own buttons: title bar, update chip, image thumbnails, 3D tree rows.
const ALLOWED = [".va-titlebar", ".va-update >", ".image-thumbs", ".va3d-panel-head", ".va3d-row"];

test("container rules only place buttons; their look comes from the shared layer", () => {
  const offenders: string[] = [];
  for (const file of cssFiles("src").filter((f) => !/[\\/](base|tokens)\.css$/.test(f))) {
    for (const r of rules(readFileSync(file, "utf8"))) {
      if (!/(^|;)\s*(background|background-color|border|border-radius|box-shadow|padding)\s*:/.test(r.body)) continue;
      for (const s of r.selectors) {
        // `:not(button)` excludes buttons, so it does not count as styling one.
        if (!/(^|[\s>+~(,])button\b/.test(s.replace(/:not\([^)]*\)/g, ""))) continue;
        if (ALLOWED.some((a) => s.startsWith(a))) continue;
        offenders.push(`${file}: ${s}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
