import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseMesh, parseObjText } from "../src/three/worker/parse-mesh";
import { transferables } from "../src/three/worker/protocol";
import { buildTree } from "../src/three/core/scene-model";

const FIX = join(__dirname, "fixtures", "3d");
function fixture(name: string): ArrayBuffer {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

test("ascii stl: one mesh, 12 triangles, bounds, no normals (flat shaded)", () => {
  const f = parseMesh("stl", fixture("cube-ascii.stl"));
  expect(f.meshes).toHaveLength(1);
  const m = f.meshes[0];
  expect(m.positions.length).toBe(12 * 9);
  expect(m.normals).toBeUndefined();
  expect(m.indices).toBeUndefined();
  expect(m.bounds).toEqual([0, 0, 0, 1, 1, 1]);
  expect(f.tree).toEqual({ meshes: [0], children: [] });
  const root = buildTree(f.tree, "cube.stl", "f1", f.meshes.map((x) => x.name));
  expect(root).toMatchObject({ id: "f1", kind: "file", meshIds: [0], children: [] });
});

test("binary stl with a 'solid' header parses as binary", () => {
  const f = parseMesh("stl", fixture("cube-binary.stl"));
  expect(f.meshes[0].positions.length).toBe(12 * 9);
  expect(f.meshes[0].bounds).toEqual([0, 0, 0, 1, 1, 1]);
  expect(f.meshes[0].normals).toBeUndefined();
});

test("obj: o/g become tree nodes, groups nest under their object", () => {
  const f = parseMesh("obj", fixture("groups.obj"));
  expect(f.meshes.map((m) => m.name)).toEqual(["Body", "Lid", "Side", "Pin"]);
  expect(f.meshes.map((m) => m.positions.length / 3)).toEqual([6, 6, 3, 6]);
  // Non-indexed triangles without normals are flat-shaded; no normals are computed or sent.
  expect(f.meshes.every((m) => m.normals === undefined)).toBe(true);
  expect(f.tree).toEqual({
    meshes: [],
    children: [
      {
        name: "Body",
        meshes: [0],
        children: [
          { name: "Lid", meshes: [1], children: [] },
          { name: "Side", meshes: [2], children: [] },
        ],
      },
      { name: "Pin", meshes: [3], children: [] },
    ],
  });
  const root = buildTree(f.tree, "groups.obj", "f1", f.meshes.map((m) => m.name));
  const ids = (n: { id: string; name: string; children: any[] }): string[] => [`${n.id}=${n.name}`, ...n.children.flatMap(ids)];
  expect(ids(root)).toEqual(["f1=groups.obj", "f1/0=Body", "f1/0/0=Lid", "f1/0/1=Side", "f1/0/m0=Body", "f1/1=Pin"]);
});

test("obj: loose faces stay on the root, repeated groups merge, empty objects are dropped", () => {
  const text = [
    "v 0 0 0", "v 1 0 0", "v 0 1 0",
    "f 1 2 3", // before any o/g
    "o Empty",
    "o A",
    "g G",
    "f 1 2 3",
    "g H",
    "f 1 2 3",
    "g G",
    "f 1 3 2",
    "g",
    "f 1 2 3",
  ].join("\r\n");
  const f = parseObjText(text);
  expect(f.meshes.map((m) => m.name)).toEqual(["", "G", "H", "G", ""]);
  expect(f.tree).toEqual({
    meshes: [0],
    children: [
      {
        name: "A",
        meshes: [],
        children: [
          { name: "G", meshes: [1, 3], children: [] },
          { name: "H", meshes: [2], children: [] },
          { name: "", meshes: [4], children: [] },
        ],
      },
    ],
  });
});

test("obj: names keep their text (no tag leaks)", () => {
  const f = parseObjText("v 0 0 0\nv 1 0 0\nv 0 1 0\no  Part </script> 1 \nf 1 2 3\n");
  expect(f.meshes[0].name).toBe("Part </script> 1");
  expect(f.tree.children[0].name).toBe("Part </script> 1");
});

test("ply with faces and colors: indexed, vertex colors, normals", () => {
  const f = parseMesh("ply", fixture("cube-color.ply"));
  const m = f.meshes[0];
  expect(m.positions.length).toBe(8 * 3);
  expect(m.indices).toBeInstanceOf(Uint32Array);
  expect(m.indices?.length).toBe(12 * 3);
  expect(m.colors?.length).toBe(8 * 3);
  expect(m.normals?.length).toBe(8 * 3);
  expect(m.primitive ?? "triangles").toBe("triangles");
});

test("ply without faces is a point cloud", () => {
  const f = parseMesh("ply", fixture("points.ply"));
  expect(f.meshes[0].primitive).toBe("points");
  expect(f.meshes[0].positions.length).toBe(5 * 3);
  expect(f.meshes[0].normals).toBeUndefined();
});

test("transferables lists each buffer once", () => {
  const f = parseMesh("ply", fixture("cube-color.ply"));
  const list = transferables(f);
  expect(new Set(list).size).toBe(list.length);
  expect(list).toContain(f.meshes[0].positions.buffer);
  expect(list).toContain(f.meshes[0].indices!.buffer);
});

test("unsupported format throws", () => {
  expect(() => parseMesh("step" as never, new ArrayBuffer(0))).toThrow();
});

import { chunkMesh, meshPieces } from "../src/three/worker/parse-mesh";

test("parseMesh splits big meshes into chunks under one mesh entry (non-indexed: shared buffer views)", () => {
  const f = parseMesh("stl", fixture("cube-ascii.stl"), 5);
  expect(f.meshes).toHaveLength(1);
  expect(f.tree).toEqual({ meshes: [0], children: [] });
  const pieces = meshPieces(f.meshes[0]);
  expect(pieces.map((p) => p.positions.length / 9)).toEqual([5, 5, 2]);
  expect(new Set(pieces.map((p) => p.positions.buffer)).size).toBe(1);
  expect(f.meshes[0].bounds).toEqual([0, 0, 0, 1, 1, 1]);
  expect(pieces.every((p) => p.bounds!.length === 6)).toBe(true);
  // One buffer, transferred once.
  expect(transferables(f)).toHaveLength(1);
});

test("chunkMesh: indexed meshes get compacted vertices per index range", () => {
  const whole = parseMesh("ply", fixture("cube-color.ply")).meshes[0];
  const pieces = chunkMesh(whole, 5);
  expect(pieces.map((p) => p.indices!.length)).toEqual([15, 15, 6]);
  const expand = (m: typeof whole, attr: "positions" | "colors") =>
    Array.from(m.indices!).flatMap((i) => Array.from(m[attr]!.subarray(i * 3, i * 3 + 3)));
  expect(pieces.flatMap((p) => expand(p, "positions"))).toEqual(expand(whole, "positions"));
  expect(pieces.flatMap((p) => expand(p, "colors"))).toEqual(expand(whole, "colors"));
  for (const p of pieces) {
    expect(Math.max(...p.indices!)).toBeLessThan(p.positions.length / 3);
    expect(p.normals!.length).toBe(p.positions.length);
  }
});

test("chunkMesh: small meshes and point clouds", () => {
  const whole = parseMesh("ply", fixture("cube-color.ply")).meshes[0];
  expect(chunkMesh(whole, 12)).toEqual([whole]);
  const pts = parseMesh("ply", fixture("points.ply")).meshes[0];
  const pieces = chunkMesh(pts, 1); // 1 "triangle" budget = 3 points
  expect(pieces.map((p) => p.positions.length / 3)).toEqual([3, 2]);
  expect(pieces.every((p) => p.primitive === "points")).toBe(true);
});

test("obj with vn keeps its normals", () => {
  const f = parseObjText("v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\n");
  expect(Array.from(f.meshes[0].normals!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
});
