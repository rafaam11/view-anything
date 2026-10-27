import { expect, test } from "vitest";
import { resolveViewer } from "../src/registry";
import { THREE_D_EXTENSIONS } from "../src/three/formats";

test("md and markdown map to md viewer, case-insensitive", () => {
  expect(resolveViewer("C:\\a\\B.MD")).not.toBeNull();
  expect(resolveViewer("/x/y.markdown")).not.toBeNull();
});
test("unknown extension returns null", () => {
  expect(resolveViewer("a.xyz")).toBeNull();
  expect(resolveViewer("noext")).toBeNull();
  expect(resolveViewer("C:\\x.y\\noext")).toBeNull();
});
test("every 3D extension maps to the shared 3D viewer loader, case-insensitive", () => {
  const md = resolveViewer("a.md");
  const stl = resolveViewer("a.stl");
  expect(stl).not.toBeNull();
  expect(stl).not.toBe(md);
  for (const ext of THREE_D_EXTENSIONS) {
    expect(resolveViewer(`C:\\m\\part.${ext}`), ext).toBe(stl);
    expect(resolveViewer(`/m/part.${ext.toUpperCase()}`), ext).toBe(stl);
  }
});
test("3D loader resolves to a viewer with mount", async () => {
  const viewer = await resolveViewer("a.glb")!();
  expect(typeof viewer.mount).toBe("function");
});
