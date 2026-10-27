// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";

vi.mock("../src/platform", () => ({
  platform: {
    assetUrl: (p: string) => "asset://" + p,
    readFileRaw: async () => new ArrayBuffer(0),
    setWindowTitle: async () => {},
  },
}));

import viewer, { describeLoadError } from "../src/three/viewer";

test("3D viewer shows a WebGL2 notice when WebGL2 is unavailable", async () => {
  const el = document.createElement("div");
  el.textContent = "old";
  await viewer.mount(el, "C:\\m\\part.stl");
  expect(el.textContent).toContain("WebGL2");
  expect(el.textContent).not.toContain("old");
});

test("describeLoadError: out-of-memory gets a dedicated message", () => {
  expect(describeLoadError("big.stl", new RangeError("Array buffer allocation failed"))).toContain("메모리가 부족");
  expect(describeLoadError("a.obj", new Error("RangeError: Invalid array length"))).toContain("메모리가 부족");
  expect(describeLoadError("a.obj", new Error("HTTP 404"))).toBe("a.obj: 파일을 열 수 없습니다. (HTTP 404)");
});
