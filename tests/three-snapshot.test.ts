// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { downloadBlob, snapshotCanvas } from "../src/three/core/snapshot";
import { screenshotPath } from "../src/three/viewer";

afterEach(() => vi.restoreAllMocks());

test("the canvas is captured right after a render, in the same task", async () => {
  const canvas = document.createElement("canvas");
  const order: string[] = [];
  vi.spyOn(canvas, "toBlob").mockImplementation((cb: BlobCallback, type?: string) => {
    order.push("toBlob:" + type);
    cb(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
  });
  const blob = await snapshotCanvas(() => order.push("render"), canvas);
  expect(order).toEqual(["render", "toBlob:image/png"]);
  expect(blob.size).toBe(3);
});

test("a canvas that cannot be encoded is an error, not a silent empty file", async () => {
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "toBlob").mockImplementation((cb: BlobCallback) => cb(null));
  await expect(snapshotCanvas(() => {}, canvas)).rejects.toThrow("이미지로 만들 수 없습니다");
});

test("the exported page downloads the PNG through a temporary link", () => {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  downloadBlob(new Blob(["png"]), "scene.png");
  expect(create).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("scene.png");
  expect(revoke).toHaveBeenCalledWith("blob:x");
  expect(document.querySelector("a[download]")).toBeNull();
});

test("the suggested file sits next to the first model, or is scene.png", () => {
  expect(screenshotPath("D:\\m\\pump.step")).toBe("D:\\m\\pump.png");
  expect(screenshotPath("/home/u/scan.tar.ply")).toBe("/home/u/scan.tar.png");
  expect(screenshotPath("D:\\m\\noext")).toBe("D:\\m\\noext.png");
  expect(screenshotPath(undefined)).toBe("scene.png");
});
