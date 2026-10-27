// Usage: node scripts/bench-edges.mjs [triangles=1000000]
// Times edge extraction on a synthetic STL-like triangle soup (a bumpy sphere, every triangle
// with its own three vertices): three's EdgesGeometry vs fastEdgePositions (core/fast-edges.ts,
// used by the geometry worker). Prints ms and ms per 1M triangles. Nothing is written.
import { BufferAttribute, BufferGeometry, EdgesGeometry } from "three";
import { runnerImport } from "vite";

const target = Number(process.argv[2] ?? 1_000_000);
const { module: fe } = await runnerImport("./src/three/core/fast-edges.ts");

// Lat-long sphere with noise: rows x cols quads = 2 * rows * cols triangles.
const cols = Math.ceil(Math.sqrt(target / 2) * 1.5);
const rows = Math.ceil(target / 2 / cols);
const tris = rows * cols * 2;
const pos = new Float32Array(tris * 9);
let seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const grid = [];
for (let i = 0; i <= rows; i++) {
  const row = [];
  for (let j = 0; j <= cols; j++) {
    const th = (Math.PI * i) / rows;
    const ph = (2 * Math.PI * (j % cols)) / cols;
    const r = 100 * (1 + 0.02 * rnd());
    row.push([r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]);
  }
  row[cols] = row[0];
  grid.push(row);
}
let o = 0;
const put = (v) => {
  pos[o++] = v[0];
  pos[o++] = v[1];
  pos[o++] = v[2];
};
for (let i = 0; i < rows; i++)
  for (let j = 0; j < cols; j++) {
    const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
    put(a); put(b); put(c);
    put(a); put(c); put(d);
  }

const per = (ms) => ((ms * 1e6) / tris).toFixed(0);
console.log(`triangles: ${tris.toLocaleString("en-US")} (non-indexed)`);

let t = performance.now();
const fast = fe.fastEdgePositions(pos, null, 30);
const fastMs = performance.now() - t;
console.log(`fastEdgePositions: ${fastMs.toFixed(0)} ms (${per(fastMs)} ms / 1M tris), ${fast.length / 6} segments`);

if (process.argv.includes("--no-three")) process.exit(0);
const g = new BufferGeometry();
g.setAttribute("position", new BufferAttribute(pos, 3));
t = performance.now();
const ref = new EdgesGeometry(g, 30).getAttribute("position").array;
const refMs = performance.now() - t;
console.log(`three EdgesGeometry: ${refMs.toFixed(0)} ms (${per(refMs)} ms / 1M tris), ${ref.length / 6} segments`);
let same = ref.length === fast.length;
for (let i = 0; same && i < ref.length; i++) same = ref[i] === fast[i];
console.log(`identical output: ${same}; speedup ${(refMs / fastMs).toFixed(1)}x`);
