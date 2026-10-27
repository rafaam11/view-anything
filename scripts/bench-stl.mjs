// Usage: node scripts/bench-stl.mjs [triangles=3000000] [--keep]
// Writes a synthetic binary STL (default 3M triangles = ~150 MB) into the OS temp folder, then
// times reading it and parseMesh (src/three/worker/parse-mesh.ts, what the parse worker runs)
// in node. The file is deleted afterwards unless --keep (its path is printed). Nothing is
// written into the repository. Main-thread blocking in the app (GPU upload in chunks) cannot be
// measured here: see the manual checklist.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runnerImport } from "vite";

const tris = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 3_000_000);
const keep = process.argv.includes("--keep");

// A height-field strip: rows of quads, every triangle with its own normal and three vertices.
const bytes = new Uint8Array(84 + 50 * tris);
const view = new DataView(bytes.buffer);
new TextEncoder().encodeInto("solid-ish header: binary STL from view-anything bench", bytes);
view.setUint32(80, tris, true);
const cols = 1000;
const h = (x, y) => Math.sin(x * 0.01) * Math.cos(y * 0.013) * 5;
let o = 84;
const vtx = (x, y) => {
  view.setFloat32(o, x, true);
  view.setFloat32(o + 4, y, true);
  view.setFloat32(o + 8, h(x, y), true);
  o += 12;
};
let t0 = performance.now();
for (let t = 0; t < tris; t++) {
  const q = t >> 1;
  const x = q % cols;
  const y = Math.floor(q / cols);
  o += 12; // normal (zero)
  if (t & 1) {
    vtx(x, y);
    vtx(x + 1, y + 1);
    vtx(x, y + 1);
  } else {
    vtx(x, y);
    vtx(x + 1, y);
    vtx(x + 1, y + 1);
  }
  o += 2; // attribute byte count
}
const dir = mkdtempSync(join(tmpdir(), "va-bench-"));
const file = join(dir, `synthetic-${tris}.stl`);
writeFileSync(file, bytes);
console.log(`wrote ${file}: ${(bytes.length / 1e6).toFixed(1)} MB, ${tris.toLocaleString("en-US")} triangles (${(performance.now() - t0).toFixed(0)} ms)`);

const { module: pm } = await runnerImport("./src/three/worker/parse-mesh.ts");
try {
  for (let run = 1; run <= 3; run++) {
    t0 = performance.now();
    const buf = readFileSync(file);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const read = performance.now() - t0;
    t0 = performance.now();
    const parsed = pm.parseMesh("stl", ab);
    const parse = performance.now() - t0;
    const pieces = parsed.meshes.flatMap((m) => pm.meshPieces(m));
    const out = pieces.reduce((n, m) => n + m.positions.length / 9, 0);
    console.log(
      `run ${run}: read ${read.toFixed(0)} ms, parseMesh ${parse.toFixed(0)} ms ` +
        `(${((parse * 1e6) / tris).toFixed(0)} ms / 1M tris), ${pieces.length} chunks, ${out.toLocaleString("en-US")} triangles`,
    );
  }
} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
