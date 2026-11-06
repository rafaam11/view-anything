import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const tokens = readFileSync("src/ui/tokens.css", "utf8");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : [],
  );
}
/** `--name: value` pairs of the first block opened by `header` (balanced braces). */
function block(source: string, header: string): Map<string, string> {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`block not found: ${header}`);
  let depth = 0, i = source.indexOf("{", start);
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) break;
  }
  const body = source.slice(open + 1, i);
  return new Map([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

test("the dark theme is the same whether chosen or followed from the system", () => {
  const followed = block(tokens, '@media (prefers-color-scheme: dark)');
  const chosen = block(tokens, ':root[data-theme="dark"]');
  expect(chosen.size).toBeGreaterThan(10);
  expect(Object.fromEntries(followed)).toEqual(Object.fromEntries(chosen));
});

test("every light colour has a dark counterpart", () => {
  const light = block(tokens, ":root {");
  const dark = block(tokens, ':root[data-theme="dark"]');
  for (const name of dark.keys()) expect(light.has(name), name).toBe(true);
});

test("every custom property a stylesheet reads is defined somewhere", () => {
  const files = cssFiles("src").map((f) => readFileSync(f, "utf8"));
  const defined = new Set(files.flatMap((s) => [...s.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])));
  // Set from TypeScript at runtime (preferences, PDF page scale).
  for (const name of ["--va-md-font", "--va-md-size", "--va-md-width", "--va-text-font", "--va-text-size", "--scale-factor"]) defined.add(name);
  const used = new Set(files.flatMap((s) => [...s.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])));
  expect([...used].filter((name) => !defined.has(name))).toEqual([]);
});

test("theme colours live only in the token file", () => {
  for (const file of cssFiles("src").filter((f) => !f.endsWith("tokens.css"))) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(/^\s*--(bg|fg|muted|border|accent|danger|backdrop)\s*:/m);
  }
});
