import { expect, test } from "vitest";
import { THREE_D_EXTENSIONS, formatOf, isBinaryStl, isThreeD } from "../src/three/formats";

test("all v0.2 extensions are listed", () => {
  expect([...THREE_D_EXTENSIONS].sort()).toEqual(["glb", "gltf", "iges", "igs", "obj", "ply", "step", "stl", "stp"]);
});

test("formatOf is case-insensitive and folds aliases", () => {
  expect(formatOf("a.STL")).toBe("stl");
  expect(formatOf("a.Obj")).toBe("obj");
  expect(formatOf("a.ply")).toBe("ply");
  expect(formatOf("a.GLTF")).toBe("gltf");
  expect(formatOf("a.glb")).toBe("glb");
  expect(formatOf("a.step")).toBe("step");
  expect(formatOf("a.STP")).toBe("step");
  expect(formatOf("a.iges")).toBe("iges");
  expect(formatOf("a.IGS")).toBe("iges");
});

test("formatOf handles both path separators and dotted folders", () => {
  expect(formatOf("C:\\models.v2\\part.StEp")).toBe("step");
  expect(formatOf("/home/u/x.y/mesh.stl")).toBe("stl");
  expect(formatOf("C:\\x.stl\\noext")).toBeNull();
  expect(formatOf("/x.glb/readme")).toBeNull();
  expect(formatOf("noext")).toBeNull();
  expect(formatOf("a.md")).toBeNull();
  expect(formatOf("stl")).toBeNull();
});

test("isThreeD follows formatOf", () => {
  expect(isThreeD("D:\\a\\b.IGS")).toBe(true);
  expect(isThreeD("D:\\a\\b.md")).toBe(false);
});

function binaryStl(triangles: number, header = ""): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * triangles);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  new DataView(bytes.buffer).setUint32(80, triangles, true);
  return bytes;
}

test("binary STL is detected by size formula", () => {
  expect(isBinaryStl(binaryStl(0))).toBe(true);
  expect(isBinaryStl(binaryStl(3, "exported by tool"))).toBe(true);
});

test("binary STL whose header starts with 'solid' is still binary", () => {
  expect(isBinaryStl(binaryStl(2, "solid part exported by SolidWorks"))).toBe(true);
});

test("ASCII STL is not binary", () => {
  const ascii = new TextEncoder().encode(
    "solid cube\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid cube\n",
  );
  expect(isBinaryStl(ascii)).toBe(false);
  expect(isBinaryStl(new TextEncoder().encode("solid x\nendsolid x\n"))).toBe(false);
  expect(isBinaryStl(new TextEncoder().encode("  solid x\nendsolid x\n" + " ".repeat(100)))).toBe(false);
});

test("non-'solid' data whose size does not match is treated as binary", () => {
  const b = binaryStl(2, "binary");
  const padded = new Uint8Array(b.length + 7);
  padded.set(b);
  expect(isBinaryStl(padded)).toBe(true);
});

test("too-short data is not binary STL", () => {
  expect(isBinaryStl(new Uint8Array(10))).toBe(false);
});
