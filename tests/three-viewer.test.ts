// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";

vi.mock("../src/platform", () => ({
  platform: {
    assetUrl: (p: string) => "asset://" + p,
    readFileRaw: async () => new ArrayBuffer(0),
    setWindowTitle: async () => {},
  },
}));

import viewer, { Banner, describeLoadError } from "../src/three/viewer";
import { RetryableCadError } from "../src/three/worker/protocol";

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

test("load error banner: retry action button runs once and hides the banner", () => {
  const banner = new Banner();
  let runs = 0;
  banner.show("big.step: 파일이 너무 크거나 손상됨", { label: "정밀도를 낮춰 다시 시도", run: () => runs++ });
  const button = [...banner.root.querySelectorAll("button")].find((b) => b.textContent === "정밀도를 낮춰 다시 시도")!;
  expect(button).toBeDefined();
  button.click();
  expect(runs).toBe(1);
  expect(banner.root.hidden).toBe(true);
  banner.show("plain error");
  expect([...banner.root.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["×"]);
});

test("describeLoadError: retryable step/iges failure says too big or damaged", () => {
  expect(describeLoadError("a.step", new RetryableCadError("RuntimeError: Aborted(OOM)"))).toBe(
    "a.step: 파일이 너무 크거나 손상됨. (RuntimeError: Aborted(OOM))",
  );
});
