// Usage: node scripts/check-bundle.mjs   (after `npm run build`)
// Exits 1 if three.js or occt is statically reachable from the entry chunk, the md viewer or the
// other lazy viewers (PDF, image, text, CSV, JSON/YAML), if the entry or md viewer chunk is over
// its size budget, and if the exported-HTML runtime (build/runtime/va-runtime.js) is missing or
// references Tauri. Reads the Vite 8 (rolldown) manifest at dist/.vite/manifest.json. The manifest
// lists chunks, not the modules inlined into them, so each reached chunk's code is also scanned for
// markers that survive minification.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MD_VIEWER = "src/md/viewer.ts";
const FORBIDDEN = /three|occt|pdfjs|plugin-updater|plugin-process/i;
// `window.__THREE__ = REVISION` (three.core.js) and emscripten's default wasm file name.
const CODE_MARKERS = /__THREE__|occt-import-js\.wasm|pdfjsLib|pdfjsWorker|plugin:updater\||plugin:process\|/;
/** The other lazy viewers may load PDF.js or the updater (the PDF viewer must), but never the 3D stack. */
const OTHER_VIEWERS = ["src/pdf/viewer.ts", "src/image/viewer.ts", "src/text/viewer.ts", "src/data/csv-viewer.ts", "src/data/structured-viewer.ts"];
const FORBIDDEN_3D = /three|occt/i;
const CODE_MARKERS_3D = /__THREE__|occt-import-js\.wasm/;
/**
 * highlight.js core loads only when a code file is shown. `highlightAuto` is a core method the text
 * viewer itself never calls (it does call `registerLanguage`, so that name cannot be the marker).
 */
const TEXT_VIEWER = "src/text/viewer.ts";
const CODE_MARKERS_TEXT = /__THREE__|occt-import-js\.wasm|highlightAuto/;
/**
 * Size budgets of the chunks that decide startup, in KiB (v0.14.0: entry 37, md viewer 707).
 * The entry chunk is the one every double-click pays for; the md viewer is the most opened.
 */
const BUDGET_KIB = { entry: 60, [MD_VIEWER]: 800 };

function label(key, chunk) {
  return `${key} (${chunk?.file ?? "?"})`;
}

function isForbidden(key, chunk, forbidden = FORBIDDEN) {
  return [key, chunk.src, chunk.file, ...(chunk.assets ?? [])].some((s) => typeof s === "string" && forbidden.test(s));
}

/** Static-import closure from `start`; returns problems for every forbidden chunk reached. */
function walk(manifest, start, root, readChunk, forbidden = FORBIDDEN, markers = CODE_MARKERS) {
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
    if (isForbidden(key, chunk, forbidden)) {
      problems.push(`${root} statically reaches ${label(key, chunk)} via ${path.join(" -> ")}`);
    } else if (readChunk && typeof chunk.file === "string" && /\.m?js$/.test(chunk.file)) {
      const code = readChunk(chunk.file);
      const hit = code === null ? null : markers.exec(code);
      if (code === null) problems.push(`${root}: chunk file ${chunk.file} is missing`);
      else if (hit) problems.push(`${root} statically reaches ${label(key, chunk)} which inlines lazy-only code (${hit[0]}) via ${path.join(" -> ")}`);
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
  for (const viewer of OTHER_VIEWERS) {
    const key = Object.keys(manifest).find((k) => k === viewer || manifest[k]?.src === viewer);
    if (key) problems.push(...walk(manifest, key, key, readChunk, FORBIDDEN_3D, viewer === TEXT_VIEWER ? CODE_MARKERS_TEXT : CODE_MARKERS_3D));
  }
  if (readChunk) {
    const budgets = [...entries.map((k) => [k, BUDGET_KIB.entry]), ...(md ? [[md, BUDGET_KIB[MD_VIEWER]]] : [])];
    for (const [key, limit] of budgets) {
      const file = manifest[key]?.file;
      const code = typeof file === "string" ? readChunk(file) : null;
      const kib = code === null ? 0 : Math.ceil(Buffer.byteLength(code) / 1024);
      if (kib > limit) problems.push(`${key} chunk ${file} is ${kib} KiB, over the ${limit} KiB budget`);
    }
  }
  return problems;
}

/** Sizes of the budgeted chunks, for the success line. */
export function budgetReport(manifest, readChunk) {
  const parts = [];
  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk?.isEntry && key !== MD_VIEWER && chunk?.src !== MD_VIEWER) continue;
    const code = typeof chunk.file === "string" ? readChunk(chunk.file) : null;
    if (code !== null) parts.push(`${chunk.isEntry ? "entry" : "md"} ${Math.ceil(Buffer.byteLength(code) / 1024)} KiB`);
  }
  return parts.join(", ");
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
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const problems = checkManifest(manifest, readChunk);
  const runtime = join(root, "build", "runtime", "va-runtime.js");
  if (existsSync(runtime)) problems.push(...checkRuntime(readFileSync(runtime, "utf8")));
  else problems.push(`${runtime} not found; run \`npm run build\` (it builds the exported-HTML runtime first)`);
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`bundle OK: no viewer chunk statically imports three/occt, entry and md stay within budget (${budgetReport(manifest, readChunk)}); the html runtime has no Tauri`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
