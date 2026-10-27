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
