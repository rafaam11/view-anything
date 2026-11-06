import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// The overlay only lines up if the <pre> and the textarea keep the same box and the same glyph
// widths. Layout cannot be measured here, so these rules are checked in the stylesheet itself.
const css = readFileSync("src/text/viewer.css", "utf8");
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

test("highlight colours never change glyph widths", () => {
  const tokens = rules.filter((r) => r.selector.includes(".hljs-"));
  expect(tokens.length).toBeGreaterThan(0);
  for (const r of tokens) expect(r.body, r.selector).not.toMatch(/font|letter-spacing/);
});

test("the layer uses the textarea's font, size, line height and tab size", () => {
  const pick = (selector: string) => rules.find((r) => r.selector === selector)!.body;
  const source = pick(".text-root .text-source"), layer = pick(".text-root .text-highlight");
  for (const prop of ["font-family", "font-size", "line-height", "tab-size", "padding"]) {
    const value = (body: string) => new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();
    expect(value(layer), prop).toBe(value(source));
  }
});

test("scrollbars do not depend on whether colours are shown at the moment", () => {
  for (const r of rules.filter((r) => r.selector.includes("data-highlight"))) {
    expect(r.body, r.selector).not.toMatch(/overflow/);
  }
  const mirrored = rules.filter((r) => r.selector.includes("data-mirror") && /overflow-y\s*:\s*scroll/.test(r.body));
  expect(mirrored.some((r) => r.selector.includes(".text-source") && r.selector.includes(".text-highlight"))).toBe(true);
});
