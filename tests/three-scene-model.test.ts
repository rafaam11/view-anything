import { describe, expect, test } from "vitest";
import {
  buildTree,
  findNode,
  removeFile,
  setVisible,
  visibleMeshIds,
  type ParsedTree,
  type SceneFile,
  type SceneModel,
} from "../src/three/core/scene-model";

/** occt-import-js shaped result: unnamed root, nested assembly, meshes by index. */
const occtFixture: ParsedTree = {
  name: "",
  meshes: [],
  children: [
    {
      name: "Assembly1",
      meshes: [],
      children: [
        { name: "Bolt", meshes: [0], children: [] },
        { name: "", meshes: [1], children: [] },
        { name: "", meshes: [], children: [] },
      ],
    },
    { name: "", meshes: [2], children: [] },
  ],
};
const occtMeshNames = ["bolt-mesh", "", "Nut"];

function file(id: string, parsed: ParsedTree, meshNames: string[] = []): SceneFile {
  return {
    id,
    path: `C:/x/${id}.step`,
    name: `${id}.step`,
    format: "step",
    sourceFrame: "as-is",
    sourceUnit: "as-is",
    root: buildTree(parsed, `${id}.step`, id, meshNames),
  };
}

describe("buildTree", () => {
  test("merges an unnamed single root into the file node", () => {
    const root = buildTree(occtFixture, "part.step", "f1", occtMeshNames);
    expect(root.kind).toBe("file");
    expect(root.id).toBe("f1");
    expect(root.name).toBe("part.step");
    expect(root.visible).toBe(true);
    expect(root.children.map((c) => c.name)).toEqual(["Assembly1", "Nut"]);
  });

  test("assigns stable path ids, kinds and fills empty names", () => {
    const root = buildTree(occtFixture, "part.step", "f1", occtMeshNames);
    const asm = root.children[0];
    expect(asm.id).toBe("f1/0");
    expect(asm.kind).toBe("assembly");
    expect(asm.children.map((c) => c.id)).toEqual(["f1/0/0", "f1/0/1", "f1/0/2"]);
    // named node keeps its name; empty name with empty mesh name -> Part N; no meshes -> Part N
    expect(asm.children.map((c) => c.name)).toEqual(["Bolt", "Part 1", "Part 2"]);
    expect(asm.children.map((c) => c.kind)).toEqual(["part", "part", "part"]);
    expect(asm.children.map((c) => c.meshIds)).toEqual([[0], [1], []]);
    // empty node name falls back to the mesh name
    expect(root.children[1]).toMatchObject({ id: "f1/1", name: "Nut", kind: "part", meshIds: [2] });
  });

  test("ids are stable across rebuilds", () => {
    const a = buildTree(occtFixture, "part.step", "f1", occtMeshNames);
    const b = buildTree(occtFixture, "part.step", "f1", occtMeshNames);
    expect(b).toEqual(a);
  });

  test("a named root stays as a child of the file node", () => {
    const root = buildTree({ name: "Robot", meshes: [], children: [{ meshes: [0], children: [] }] }, "r.step", "f2", ["Base"]);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toMatchObject({ id: "f2/0", name: "Robot", kind: "assembly" });
    expect(root.children[0].children[0]).toMatchObject({ id: "f2/0/0", name: "Base", kind: "part" });
  });

  test("an unnamed root holding meshes only (stl-like) puts them on the file node", () => {
    const root = buildTree({ meshes: [0], children: [] }, "a.stl", "f3");
    expect(root).toMatchObject({ id: "f3", kind: "file", name: "a.stl", meshIds: [0], children: [] });
  });

  test("direct meshes of an assembly become mesh leaves", () => {
    const root = buildTree(
      { name: "Top", meshes: [0, 1], children: [{ name: "Sub", meshes: [2], children: [] }] },
      "t.step",
      "f4",
      ["Plate", ""],
    );
    const top = root.children[0];
    expect(top.meshIds).toEqual([]);
    expect(top.children.map((c) => [c.id, c.name, c.kind, c.meshIds])).toEqual([
      ["f4/0/0", "Sub", "part", [2]],
      ["f4/0/m0", "Plate", "mesh", [0]],
      ["f4/0/m1", "Part 1", "mesh", [1]],
    ]);
  });
});

describe("buildTree guards", () => {
  test("an unnamed assembly does not borrow its direct mesh's name", () => {
    const root = buildTree(
      { name: "Top", meshes: [], children: [{ name: "", meshes: [0], children: [{ name: "Leaf", meshes: [1], children: [] }] }] },
      "t.step",
      "f5",
      ["Plate", "LeafMesh"],
    );
    const asm = root.children[0].children[0];
    expect(asm.kind).toBe("assembly");
    expect(asm.name).toBe("Part 1");
    expect(asm.children.map((c) => c.name)).toEqual(["Leaf", "Plate"]);
  });

  test("rejects a fileId containing '/'", () => {
    expect(() => buildTree({ meshes: [], children: [] }, "x.stl", "a/b")).toThrow();
  });
});

describe("model operations", () => {
  function model(): SceneModel {
    return { files: [file("a", occtFixture, occtMeshNames), file("b", { meshes: [0], children: [] })] };
  }

  test("findNode locates nodes across files", () => {
    const m = model();
    expect(findNode(m, "a/0/0")?.name).toBe("Bolt");
    expect(findNode(m, "b")?.kind).toBe("file");
    expect(findNode(m, "nope")).toBeUndefined();
  });

  test("setVisible hides a node and its meshes", () => {
    const m = model();
    expect(visibleMeshIds(m.files[0].root)).toEqual([0, 1, 2]);
    expect(setVisible(m, "a/0", false)).toBe(true);
    expect(findNode(m, "a/0")?.visible).toBe(false);
    // children keep their own flag, but are hidden through the ancestor
    expect(findNode(m, "a/0/0")?.visible).toBe(true);
    expect(visibleMeshIds(m.files[0].root)).toEqual([2]);
    setVisible(m, "a/0", true);
    setVisible(m, "a/0/1", false);
    expect(visibleMeshIds(m.files[0].root)).toEqual([0, 2]);
    expect(setVisible(m, "missing", false)).toBe(false);
  });

  test("removeFile drops the file and reports success", () => {
    const m = model();
    expect(removeFile(m, "a")).toBe(true);
    expect(m.files.map((f) => f.id)).toEqual(["b"]);
    expect(findNode(m, "a/0")).toBeUndefined();
    expect(removeFile(m, "a")).toBe(false);
  });
});
