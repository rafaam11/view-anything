// The exported-HTML runtime must not depend on Tauri: its source import graph never reaches
// @tauri-apps or src/platform.ts, and the built bundle (when present) has no Tauri markers.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vitest";

const ROOT = resolve(__dirname, "..");
const ENTRY = join(ROOT, "src", "three", "export-runtime", "main.ts");
const BUNDLE = join(ROOT, "build", "runtime", "va-runtime.js");
const TAURI_MARKERS = /@tauri-apps|__TAURI|tauri:\/\/|ipc\.localhost|plugin:dialog/;

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ""));
  for (const p of [base, `${base}.ts`, join(base, "index.ts")]) if (existsSync(p) && /\.(ts|css)$/.test(p)) return p;
  return null;
}

/** Every module specifier reachable from `entry` (local .ts files are followed). */
function importGraph(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    if (!file.endsWith(".ts")) continue;
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(/(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".")) {
        const p = resolveLocal(file, spec);
        if (p) stack.push(p);
      } else bare.add(spec);
    }
  }
  return { files, bare };
}

test("the runtime's source import graph has no Tauri module and no platform.ts", () => {
  const { files, bare } = importGraph(ENTRY);
  expect(files.size).toBeGreaterThan(5); // the shared core really is followed
  expect([...files].some((f) => f.endsWith(join("core", "panel.ts")))).toBe(true);
  expect([...bare].filter((s) => s.startsWith("@tauri-apps"))).toEqual([]);
  expect([...files].filter((f) => f === join(ROOT, "src", "platform.ts"))).toEqual([]);
  for (const f of files) if (f.endsWith(".ts")) expect(readFileSync(f, "utf8"), f).not.toMatch(/@tauri-apps/);
});

test.skipIf(!existsSync(BUNDLE))("the built runtime bundle has no Tauri markers", () => {
  const code = readFileSync(BUNDLE, "utf8");
  expect(code).not.toMatch(TAURI_MARKERS);
  // An IIFE: no ES module syntax left (it runs from an inline classic <script>).
  expect(code).not.toMatch(/^\s*import\s|\bimport\.meta\b|^export\s/m);
});

test("every stylesheet the runtime's modules import is inlined into the page", () => {
  // The IIFE build drops plain CSS imports, so main.ts must inline each one with ?inline.
  const { files } = importGraph(ENTRY);
  const plain = new Set<string>();
  for (const f of files) {
    if (!f.endsWith(".ts")) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/^import\s+["']([^"']+\.css)["'];/gm)) plain.add(resolve(dirname(f), m[1]));
  }
  const main = readFileSync(ENTRY, "utf8");
  const inlined = new Set([...main.matchAll(/from\s+["']([^"']+\.css)\?inline["']/g)].map((m) => resolve(dirname(ENTRY), m[1])));
  expect(plain.size).toBeGreaterThan(0);
  expect([...plain].filter((p) => !inlined.has(p)).map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  // Tokens first, then the shared control layer, so every later rule can use and override them.
  const order = ["tokens.css", "base.css", "menu.css", "three.css"].map((name) => main.indexOf(`/${name}?inline`));
  expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]))).toBe(true);
});

test("the exported page shows notes and failures in the shared banner, never window.alert", () => {
  const main = readFileSync(ENTRY, "utf8");
  expect(main).toMatch(/from "\.\.\/core\/banner"/);
  expect(main).not.toMatch(/window\.alert|\balert\(/);
  expect(main).not.toContain("va-runtime-warning");
});

test("menu looks live in menu.css only; three.css just places the 3D menubar", () => {
  const css = readFileSync(join(ROOT, "src", "three", "core", "three.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
  expect(selectors.filter((s) => /\.va3d-menu-(title|item|wrap|key|sep|mark|block)\b|\.va3d-menu\b(?!bar)/.test(s))).toEqual([]);
});
