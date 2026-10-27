import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { loadOcct, mapOcctResult, readCad, type OcctModule, type OcctResult } from "../src/three/worker/occt";
import { canCoarsen, DEFLECTION_TIERS, occtParams } from "../src/three/worker/cad-params";
import { meshPieces, type MeshData } from "../src/three/worker/protocol";
import { buildTree, type TreeNode } from "../src/three/core/scene-model";

const FIX = join(__dirname, "fixtures", "3d");
const bytes = (path: string) => new Uint8Array(readFileSync(path));
const MiB = 1 << 20;

let occt: OcctModule;
beforeAll(async () => {
  occt = await loadOcct();
}, 60_000);

function triangles(m: MeshData): number {
  return meshPieces(m).reduce((n, p) => n + (p.indices ? p.indices.length : p.positions.length / 3) / 3, 0);
}

function names(node: TreeNode): unknown {
  return node.children.length ? { [node.name]: node.children.map(names) } : node.name;
}

const closeTo = (actual: number[] | undefined, expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual![i]).toBeCloseTo(v, 4));
};

test("cube.step: one part named Cube, triangles, mm bounds, face colours as vertex colours", () => {
  const file = readCad(occt, "step", bytes(join(FIX, "cube.step")), occtParams(1000));
  const root = buildTree(file.tree, "cube.step", "f1", file.meshes.map((m) => m.name));
  expect(names(root)).toEqual({ "cube.step": ["Cube"] });
  expect(root.children[0]).toMatchObject({ kind: "part", meshIds: [0] });

  expect(file.meshes).toHaveLength(1);
  const m = file.meshes[0];
  expect(m.name).toBe("Cube");
  expect(triangles(m)).toBe(12);
  expect(m.normals).toBeInstanceOf(Float32Array);
  expect(m.indices).toBeInstanceOf(Uint32Array); // faces do not share vertices: stays indexed
  closeTo(m.bounds, [0, 0, 0, 10, 20, 30]);

  // Body colour (sRGB 0.2, 0.4, 0.8 -> occt reports linear) everywhere except the red +Z face.
  const colors = m.colors!;
  expect(colors.length).toBe(m.positions.length);
  let red = 0;
  let blue = 0;
  for (let v = 0; v < colors.length / 3; v++) {
    const [r, g, b] = colors.subarray(v * 3, v * 3 + 3);
    if (r === 1 && g === 0 && b === 0) {
      red++;
      expect(m.positions[v * 3 + 2]).toBeCloseTo(30, 6);
    } else {
      blue++;
      expect([r, g, b].map((x) => +x.toFixed(3))).toEqual([0.033, 0.133, 0.604]);
    }
  }
  expect(red).toBe(4);
  expect(blue).toBe(20);
});

test("assembly.step: assembly name and two parts in order, PartB placed at x = 100 mm", () => {
  const file = readCad(occt, "step", bytes(join(FIX, "assembly.step")), occtParams(1000));
  const root = buildTree(file.tree, "assembly.step", "f1", file.meshes.map((m) => m.name));
  expect(names(root)).toEqual({ "assembly.step": [{ Assembly: ["PartA", "PartB"] }] });
  const [a, b] = root.children[0].children;
  closeTo(file.meshes[a.meshIds[0]].bounds, [0, 0, 0, 10, 10, 10]);
  closeTo(file.meshes[b.meshIds[0]].bounds, [100, 0, 0, 105, 5, 40]);
  expect(file.meshes.every((m) => triangles(m) > 0)).toBe(true);
  // No colours in the file: no vertex colours (default material colour).
  expect(file.meshes.every((m) => m.colors === undefined)).toBe(true);
});

test("cube-inch.step: inch file comes out in millimetres (x 25.4)", () => {
  const file = readCad(occt, "step", bytes(join(FIX, "cube-inch.step")), occtParams(1000));
  expect(file.meshes[0].name).toBe("InchCube");
  closeTo(file.meshes[0].bounds, [0, 0, 0, 25.4, 50.8, 76.2]);
});

const IGES = join(__dirname, "..", "node_modules", "occt-import-js", "test", "testfiles", "cube-10x10mm", "Cube 10x10.igs");
test.skipIf(!existsSync(IGES))("iges: the 10 mm cube from occt-import-js's own test files", () => {
  const file = readCad(occt, "iges", bytes(IGES), occtParams(1000));
  expect(file.meshes.length).toBeGreaterThan(0);
  expect(file.meshes.reduce((n, m) => n + triangles(m), 0)).toBeGreaterThan(0);
  const [x0, y0, z0, x1, y1, z1] = file.meshes[0].bounds!;
  expect([x1 - x0, y1 - y0, z1 - z0].map((d) => Math.round(d))).toEqual([10, 10, 10]);
});

test("readCad: a file occt cannot read is an error", () => {
  const junk = new TextEncoder().encode("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
  expect(() => readCad(occt, "step", junk, occtParams(junk.length))).toThrow(/STEP/);
});

test("readCad passes millimetre, bounding-box-ratio params and picks the reader by format", () => {
  const calls: [string, unknown][] = [];
  const ok: OcctResult = { success: true, root: { name: "", meshes: [], children: [] }, meshes: [] };
  const fake: OcctModule = {
    ReadStepFile: (_c, p) => (calls.push(["step", p]), ok),
    ReadIgesFile: (_c, p) => (calls.push(["iges", p]), ok),
  };
  readCad(fake, "iges", new Uint8Array(1), occtParams(1));
  readCad(fake, "step", new Uint8Array(1), occtParams(1));
  expect(calls.map((c) => c[0])).toEqual(["iges", "step"]);
  expect(calls[0][1]).toEqual({ linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.5 });
});

test("occtParams: deflection tiers by file size, then coarser per retry", () => {
  expect(DEFLECTION_TIERS.map((t) => [t.upTo, t.linear, t.angular])).toEqual([
    [10 * MiB, 0.001, 0.5],
    [50 * MiB, 0.003, 0.6],
    [150 * MiB, 0.01, 0.8],
    [Infinity, 0.03, 1.0],
  ]);
  const lin = (size: number, coarser = 0) => [occtParams(size, coarser).linearDeflection, occtParams(size, coarser).angularDeflection];
  expect(lin(10 * MiB)).toEqual([0.001, 0.5]);
  expect(lin(10 * MiB + 1)).toEqual([0.003, 0.6]);
  expect(lin(50 * MiB + 1)).toEqual([0.01, 0.8]);
  expect(lin(150 * MiB + 1)).toEqual([0.03, 1.0]);
  // Each retry moves one tier coarser; past the last tier linear deflection triples, up to 0.3.
  expect(lin(1000, 1)).toEqual([0.003, 0.6]);
  expect(lin(1000, 3)).toEqual([0.03, 1.0]);
  expect(lin(1000, 4)).toEqual([0.09, 1.0]);
  expect(lin(1000, 5)).toEqual([0.27, 1.0]);
  expect(lin(1000, 6)).toEqual([0.3, 1.0]);
  expect(canCoarsen(1000, 5)).toBe(true);
  expect(canCoarsen(1000, 6)).toBe(false);
  for (const size of [1, 20 * MiB, 500 * MiB]) {
    expect(occtParams(size)).toMatchObject({ linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio" });
  }
});

/** Two triangles sharing an edge (vertices 1 and 2), each its own b-rep face. */
function sharedQuad(colorA: number[] | null, colorB: number[] | null, meshColor?: number[]): OcctResult {
  return {
    success: true,
    root: { name: "", meshes: [0], children: [] },
    meshes: [
      {
        name: "quad",
        color: meshColor,
        attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0] }, normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] } },
        index: { array: [0, 1, 2, 2, 1, 3] },
        brep_faces: [
          { first: 0, last: 0, color: colorA },
          { first: 1, last: 1, color: colorB },
        ],
      },
    ],
  };
}

test("mapOcctResult: faces sharing vertices with different colours are de-indexed", () => {
  const m = mapOcctResult(sharedQuad([1, 0, 0], [0, 1, 0])).meshes[0];
  expect(m.indices).toBeUndefined();
  expect(Array.from(m.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0]);
  expect(Array.from(m.normals!)).toHaveLength(18);
  expect(Array.from(m.colors!)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  expect(m.bounds).toEqual([0, 0, 0, 1, 1, 0]);
});

test("mapOcctResult: same colour on shared vertices stays indexed; uncoloured faces use the mesh colour", () => {
  const m = mapOcctResult(sharedQuad([0, 0, 1], null, [0, 0, 1])).meshes[0];
  expect(Array.from(m.indices!)).toEqual([0, 1, 2, 2, 1, 3]);
  expect(Array.from(m.colors!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
});

test("mapOcctResult: no colours anywhere -> no vertex colours; tree copied with names", () => {
  const f = mapOcctResult(sharedQuad(null, null));
  expect(f.meshes[0].colors).toBeUndefined();
  expect(f.meshes[0].indices).toBeInstanceOf(Uint32Array);
  expect(f.tree).toEqual({ name: "", meshes: [0], children: [] });
});

test("mapOcctResult: big meshes are split into draw chunks", () => {
  const f = mapOcctResult(sharedQuad(null, null), 1);
  const m = f.meshes[0];
  expect(m.chunks).toHaveLength(2);
  expect(m.positions.length).toBe(0);
  expect(m.bounds).toEqual([0, 0, 0, 1, 1, 0]);
  expect(triangles(m)).toBe(2);
});

test("mapOcctResult: unsuccessful result throws", () => {
  expect(() => mapOcctResult({ success: false, root: { name: "", meshes: [], children: [] }, meshes: [] })).toThrow();
});

test("readCad: a source holder is emptied right after occt read it (bytes can be GC'd during mapping)", () => {
  const source: { bytes: Uint8Array | null } = { bytes: new Uint8Array(4) };
  let duringMap: Uint8Array | null | undefined;
  const mesh = {
    attributes: {
      position: {
        get array() {
          duringMap = source.bytes;
          return [0, 0, 0, 1, 0, 0, 0, 1, 0];
        },
      },
    },
  };
  const ok: OcctResult = { success: true, root: { name: "", meshes: [0], children: [] }, meshes: [mesh] };
  const fake: OcctModule = {
    ReadStepFile: (c) => {
      expect(c).toHaveLength(4);
      return ok;
    },
    ReadIgesFile: () => ok,
  };
  readCad(fake, "step", source, occtParams(4));
  expect(duringMap).toBeNull();
  expect(source.bytes).toBeNull();
});
