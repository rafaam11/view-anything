// Usage: node scripts/check-bundle.mjs   (after `npm run build`)
// Exits 1 if three.js or occt is statically reachable from the entry chunk or the md viewer
// chunk, i.e. if opening a Markdown file would download the 3D stack, and if the exported-HTML
// runtime (build/runtime/va-runtime.js) is missing or references Tauri.
// Reads the Vite 8 (rolldown) manifest at dist/.vite/manifest.json. The manifest lists chunks,
// not the modules inlined into them, so each reached chunk's code is also scanned for markers
// that survive minification.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MD_VIEWER = "src/md/viewer.ts";
const FORBIDDEN = /three|occt/i;
// `window.__THREE__ = REVISION` (three.core.js) and emscripten's default wasm file name.
const CODE_MARKERS = /__THREE__|occt-import-js\.wasm/;

function label(key, chunk) {
  return `${key} (${chunk?.file ?? "?"})`;
}

function isForbidden(key, chunk) {
  return [key, chunk.src, chunk.file, ...(chunk.assets ?? [])].some((s) => typeof s === "string" && FORBIDDEN.test(s));
}

/** Static-import closure from `start`; returns problems for every forbidden chunk reached. */
function walk(manifest, start, root, readChunk) {
  const problems = [];
  const seen = new Set();
  const stack = [[start, [start]]];
  while (stack.length) {
    const [key, path] = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) {
      problems.push(`${root}: import ${key} is missing from the manifest`);
      continue;
    }
    if (isForbidden(key, chunk)) {
      problems.push(`${root} statically reaches ${label(key, chunk)} via ${path.join(" -> ")}`);
    } else if (readChunk && typeof chunk.file === "string" && /\.m?js$/.test(chunk.file)) {
      const code = readChunk(chunk.file);
      const hit = code === null ? null : CODE_MARKERS.exec(code);
      if (code === null) problems.push(`${root}: chunk file ${chunk.file} is missing`);
      else if (hit) problems.push(`${root} statically reaches ${label(key, chunk)} which inlines three/occt code (${hit[0]}) via ${path.join(" -> ")}`);
    }
    for (const next of chunk.imports ?? []) stack.push([next, [...path, next]]);
  }
  return problems;
}

/**
 * Returns a list of problems; empty means OK. `readChunk(file)` returns a chunk's code (null if
 * missing); without it only chunk names and paths are checked.
 */
export function checkManifest(manifest, readChunk) {
  const problems = [];
  const entries = Object.keys(manifest).filter((k) => manifest[k]?.isEntry);
  if (entries.length === 0) problems.push("no entry chunk (isEntry) in the manifest");
  const md = Object.keys(manifest).find((k) => k === MD_VIEWER || manifest[k]?.src === MD_VIEWER);
  if (!md) problems.push(`md viewer chunk (${MD_VIEWER}) not found in the manifest`);
  for (const root of [...entries, ...(md ? [md] : [])]) problems.push(...walk(manifest, root, root, readChunk));
  return problems;
}

// The exported-HTML runtime (build/runtime/va-runtime.js) runs from file:// in any browser.
const TAURI_MARKERS = /@tauri-apps|__TAURI|tauri:\/\/|ipc\.localhost|plugin:dialog/;
const MODULE_SYNTAX = /^\s*import\s|\bimport\.meta\b|^export\s/m;

/** Problems of the runtime bundle's code; empty means OK. */
export function checkRuntime(code) {
  const problems = [];
  const tauri = TAURI_MARKERS.exec(code);
  if (tauri) problems.push(`va-runtime.js references Tauri (${tauri[0]}); the exported HTML must not depend on it`);
  const mod = MODULE_SYNTAX.exec(code);
  if (mod) problems.push(`va-runtime.js has ES module syntax (${mod[0].trim()}); it must be a classic IIFE`);
  return problems;
}

function main() {
  const root = process.env.VIEW_ANYTHING_ROOT || resolve(fileURLToPath(import.meta.url), "..", "..");
  const file = join(root, "dist", ".vite", "manifest.json");
  if (!existsSync(file)) throw new Error(`${file} not found; run \`npm run build\` first (build.manifest must be on)`);
  const dist = join(root, "dist");
  const readChunk = (f) => {
    const p = join(dist, f);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const problems = checkManifest(JSON.parse(readFileSync(file, "utf8")), readChunk);
  const runtime = join(root, "build", "runtime", "va-runtime.js");
  if (existsSync(runtime)) problems.push(...checkRuntime(readFileSync(runtime, "utf8")));
  else problems.push(`${runtime} not found; run \`npm run build\` (it builds the exported-HTML runtime first)`);
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log("bundle OK: entry and md viewer chunks do not statically import three/occt; the html runtime has no Tauri");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
