// @vitest-environment happy-dom
import { expect, test } from "vitest";
import viewer from "../src/three/viewer";

test("3D viewer stub shows a placeholder message", async () => {
  const el = document.createElement("div");
  el.textContent = "old";
  await viewer.mount(el, "C:\\m\\part.step");
  expect(el.textContent).toContain("3D 뷰어 준비 중");
  expect(el.textContent).not.toContain("old");
});
