import { expect, test } from "vitest";
import { resolveViewer } from "../src/registry";

test("md and markdown map to md viewer, case-insensitive", () => {
  expect(resolveViewer("C:\\a\\B.MD")).not.toBeNull();
  expect(resolveViewer("/x/y.markdown")).not.toBeNull();
});
test("unknown extension returns null", () => {
  expect(resolveViewer("a.xyz")).toBeNull();
  expect(resolveViewer("noext")).toBeNull();
  expect(resolveViewer("C:\\x.y\\noext")).toBeNull();
});
