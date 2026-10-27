import { expect, test } from "vitest";
import { batchByBudget, clipPlanes, gridSpec, orbitDirection, resolveSibling } from "../src/three/core/stage-math";

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("orbitDirection leaves non-polar views untouched", () => {
  expect(orbitDirection([0, 0, 1], [0, 1, 0], [0, 1, 0])).toEqual([0, 0, 1]);
});

test("orbitDirection nudges top/bottom views so screen-up comes out right", () => {
  // top: looking down the orbit axis (+Y world); screen-up should be +Z, so the camera leans to -Z.
  const top = orbitDirection([0, 1, 0], [0, 0, -1], [0, 1, 0]);
  expect(dot(top, [0, 1, 0])).toBeGreaterThan(0.999);
  expect(dot(top, [0, 1, 0])).toBeLessThan(1);
  expect(top[2]).toBeGreaterThan(0); // leans away from view-up (-Z)
  expect(Math.hypot(...top)).toBeCloseTo(1, 12);
  // bottom: camera below; leans toward view-up so the projected orbit axis points to view-up.
  const bottom = orbitDirection([0, -1, 0], [0, 0, -1], [0, 1, 0]);
  expect(dot(bottom, [0, -1, 0])).toBeGreaterThan(0.999);
  expect(bottom[2]).toBeLessThan(0);
});

test("clipPlanes: tight around the sphere outside, small near inside", () => {
  const out = clipPlanes(100, 10);
  expect(out.near).toBeCloseTo(90, 6);
  expect(out.far).toBeCloseTo(110, 6);
  const inside = clipPlanes(1, 10, 1);
  expect(inside.near).toBeGreaterThan(0);
  expect(inside.near).toBeLessThan(0.1);
  expect(inside.far).toBeCloseTo(11, 6);
  const degenerate = clipPlanes(0, 0);
  expect(degenerate.near).toBeGreaterThan(0);
  expect(degenerate.far).toBeGreaterThan(degenerate.near);
});

test("gridSpec: power-of-ten cells covering the model, capped divisions", () => {
  expect(gridSpec(50)).toEqual({ cell: 10, divisions: 20, size: 200 });
  expect(gridSpec(100)).toEqual({ cell: 10, divisions: 40, size: 400 });
  expect(gridSpec(0.3).cell).toBeCloseTo(0.1, 12);
  const g = gridSpec(1e6);
  expect(g.size).toBeGreaterThanOrEqual(4e6);
  expect(g.divisions).toBeLessThanOrEqual(200);
  expect(gridSpec(0).cell).toBeGreaterThan(0);
});

test("resolveSibling: relative URIs against the model's folder", () => {
  expect(resolveSibling("C:\\m\\a.gltf", "a.bin")).toBe("C:\\m\\a.bin");
  expect(resolveSibling("C:\\m\\a.gltf", "tex/b%20c.png")).toBe("C:\\m\\tex\\b c.png");
  expect(resolveSibling("C:\\m\\a.gltf", "./t/../u.png")).toBe("C:\\m\\u.png");
  expect(resolveSibling("/home/u/a.gltf", "b.bin")).toBe("/home/u/b.bin");
  expect(resolveSibling("\\\\srv\\share\\a.gltf", "b.bin")).toBe("\\\\srv\\share\\b.bin");
  expect(resolveSibling("C:\\m\\a.gltf", "bad%zz.png")).toBe("C:\\m\\bad%zz.png");
});

test("resolveSibling refuses absolute paths, UNC and other schemes", () => {
  for (const uri of ["/etc/x.bin", "//evil/share/x.bin", "\\\\evil\\share\\x.bin", "C:/x.bin", "D:\\x.bin", "file:///C:/x.bin", "https://e.com/x.bin", "%2F%2Fevil/x"]) {
    expect(resolveSibling("C:\\m\\a.gltf", uri), uri).toBeNull();
  }
});

test("clipPlanes: near floor shrinks with the camera-target distance (close zoom)", () => {
  // Inside the sphere, 0.5 from the target: floor min(R*1e-3, d*1e-2) = 0.005.
  expect(clipPlanes(1, 10, 0.5).near).toBeCloseTo(0.005, 12);
  // Far from the target the floor is capped at R*1e-3.
  expect(clipPlanes(1, 10, 100).near).toBeCloseTo(0.01, 12);
  // Absolute minimum keeps near > 0.
  expect(clipPlanes(0, 10, 0).near).toBeGreaterThan(0);
});

test("resolveSibling: '..' may not leave the model's folder", () => {
  expect(resolveSibling("C:\\m\\sub\\a.gltf", "../x.bin")).toBeNull();
  expect(resolveSibling("/home/u/a.gltf", "../../../x")).toBeNull();
  expect(resolveSibling("C:\\m\\a.gltf", "t/../../x.bin")).toBeNull();
  expect(resolveSibling("C:\\m\\a.gltf", "t/../x.bin")).toBe("C:\\m\\x.bin");
});

test("batchByBudget: consecutive groups up to the budget, oversize items alone", () => {
  expect(batchByBudget([], 10)).toEqual([]);
  expect(batchByBudget([4, 4, 4, 15, 1, 9, 1], 10)).toEqual([[0, 1], [2], [3], [4, 5], [6]]);
  expect(batchByBudget([0, 0, 0], 10)).toEqual([[0, 1, 2]]);
});
