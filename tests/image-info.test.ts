import { expect, test } from "vitest";
import { describeImage, formatBytes, imageFormat } from "../src/image/info";

test("formats sizes in binary units", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1023)).toBe("1023 B");
  expect(formatBytes(1024)).toBe("1.0 KiB");
  expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MiB");
  expect(formatBytes(100 * 1024 * 1024)).toBe("100 MiB");
  expect(formatBytes(5 * 1024 ** 4)).toBe("5120 GiB");
});

test("names the format from the extension of the file name only", () => {
  expect(imageFormat("C:\\사진\\a.png")).toBe("PNG");
  expect(imageFormat("/x/a.JPEG")).toBe("JPG");
  expect(imageFormat("/x.y/no-extension")).toBe("");
});

test("describes the file, and only the canvas once edited", () => {
  const image = { width: 2000, height: 1000, path: "a.webp", bytes: 2048, edited: false };
  expect(describeImage(image)).toBe("2000×1000 · WEBP · 2.0 KiB");
  expect(describeImage({ ...image, edited: true })).toBe("2000×1000 · 편집 중");
  expect(describeImage({ ...image, path: "no-extension" })).toBe("2000×1000 · 2.0 KiB");
});
