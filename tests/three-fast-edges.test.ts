// fastEdgePositions must give exactly what three's EdgesGeometry gives (the worker and the
// UI-thread path use it in its place): same segments, in the same order.
import { expect, test } from "vitest";
import { BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, IcosahedronGeometry, TorusGeometry, TorusKnotGeometry } from "three";
import { fastEdgePositions, weldVertices } from "../src/three/core/fast-edges";

function reference(g: BufferGeometry, deg = 30): Float32Array {
  return new EdgesGeometry(g, deg).getAttribute("position").array as Float32Array;
}

function fast(g: BufferGeometry, deg = 30): Float32Array {
  const index = g.index ? (g.index.array as Uint16Array | Uint32Array) : null;
  return fastEdgePositions(g.getAttribute("position").array as Float32Array, index, deg);
}

/** Segments as order-free strings (both endpoint orders count as the same segment). */
function segments(a: Float32Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < a.length; i += 6) {
    const p = Array.from(a.subarray(i, i + 3)).join(",");
    const q = Array.from(a.subarray(i + 3, i + 6)).join(",");
    out.push(p < q ? `${p}|${q}` : `${q}|${p}`);
  }
  return out.sort();
}

function same(g: BufferGeometry, deg = 30) {
  const expected = reference(g, deg);
  const actual = fast(g, deg);
  expect(segments(actual)).toEqual(segments(expected));
  // Stronger than asked: the order matches too.
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

// Deterministic pseudo-random numbers.
function rng(seed: number) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test("cube (indexed, subdivided) and its triangle soup", () => {
  const g = new BoxGeometry(1, 2, 3, 2, 3, 4);
  same(g);
  same(g.toNonIndexed());
});

test("torus-like smooth surfaces at several thresholds", () => {
  for (const g of [new TorusGeometry(10, 3, 16, 48), new TorusKnotGeometry(5, 1.5, 64, 8), new IcosahedronGeometry(1, 2)]) {
    for (const deg of [1, 15, 30, 60]) {
      same(g, deg);
      same(g.toNonIndexed(), deg);
    }
  }
});

test("shared vertices, open boundaries, degenerate and non-manifold triangles", () => {
  // A grid with a height field (shared indexed vertices, open boundary), plus extra triangles:
  // a degenerate one, a duplicated face (same direction), a flipped duplicate, a fin on an edge.
  const r = rng(7);
  const N = 12;
  const pos: number[] = [];
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) pos.push(x, y, (r() - 0.5) * 2);
  const idx: number[] = [];
  const at = (x: number, y: number) => y * (N + 1) + x;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) idx.push(at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y), at(x + 1, y + 1), at(x, y + 1));
  const extra = pos.length / 3;
  pos.push(0.00001, 0, 0, 5, 5, 9); // weld onto vertex 0 (same 1e-4 cell), and a fin apex
  idx.push(0, extra, 1); // degenerate after welding
  idx.push(at(3, 3), at(4, 3), at(4, 4)); // duplicate, same direction
  idx.push(at(5, 5), at(6, 6), at(6, 5)); // flipped duplicate
  idx.push(at(7, 7), at(8, 7), extra + 1); // fin: third face on an edge
  idx.push(at(8, 7), at(7, 7), extra + 1);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  same(g);
  same(g.toNonIndexed());
  // Bigger coordinates (grid keys beyond 32 bits) and negative ones.
  const big = g.clone();
  const p = big.getAttribute("position");
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * 1e6 - 3e6, p.getY(i) * -1e6, p.getZ(i) * 1e5);
  same(big);
});

test("random triangle soup with repeated vertices", () => {
  const r = rng(42);
  const pts: number[][] = [];
  for (let i = 0; i < 60; i++) pts.push([Math.round(r() * 8), Math.round(r() * 8), Math.round(r() * 8)].map((v) => v / 4));
  const pos: number[] = [];
  for (let t = 0; t < 400; t++) for (let k = 0; k < 3; k++) pos.push(...pts[Math.floor(r() * pts.length)]);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  same(g);
});

test("weldVertices maps points on the same 1e-4 grid cell to the lowest index", () => {
  const w = weldVertices(new Float32Array([0, 0, 0, 1, 1, 1, 0.00002, 0, 0, 1, 1, 1.0001, 1, 1, 1]));
  expect(Array.from(w)).toEqual([0, 1, 0, 3, 1]);
});
