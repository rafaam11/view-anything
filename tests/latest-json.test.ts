import { expect, test } from "vitest";
// @ts-expect-error Node build script tested directly.
import { makeLatest } from "../scripts/make-latest-json.mjs";
const files = [
  { name: "view-anything_0.2.0_x64-setup.exe" }, { name: "view-anything_0.2.0_x64-setup.exe.sig", text: "win-sig\n" },
  { name: "view-anything_0.2.0_amd64.AppImage" }, { name: "view-anything_0.2.0_amd64.AppImage.sig", text: "linux-sig\n" },
];
test("manifest links signed platform artifacts and extracts the summary paragraph", () => {
  const out = makeLatest("v0.2.0", files, "# v0.2.0 — title\n\n첫 문단.\n두 번째 줄.\n\n- 항목", "2026-10-27T00:00:00Z");
  expect(out.version).toBe("0.2.0");
  expect(out.notes).toBe("첫 문단.\n두 번째 줄.");
  expect(out.platforms["windows-x86_64"].signature).toBe("win-sig");
  expect(out.platforms["linux-x86_64"].url).toBe("https://github.com/rafaam11/view-anything/releases/download/v0.2.0/view-anything_0.2.0_amd64.AppImage");
});
test("manifest refuses missing, duplicate, mismatched or unsigned assets", () => {
  for (const bad of [files.slice(1), [...files, files[0]], files.slice(0, 3), [...files, files[1]]]) {
    expect(() => makeLatest("v0.2.0", bad, "notes")).toThrow();
  }
  expect(() => makeLatest("v0.3.0", files, "notes")).toThrow();
  expect(() => makeLatest("bad", files, "notes")).toThrow();
});
