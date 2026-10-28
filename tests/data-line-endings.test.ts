import { expect, test } from "vitest";
import { restoreLineEndings } from "../src/data/line-endings";

test("textarea edits preserve mixed line endings in unchanged lines", () => {
  expect(restoreLineEndings("one\r\ntwo\nthree\rfour", "one\nchanged\nthree\nfour")).toBe("one\r\nchanged\nthree\rfour");
  expect(restoreLineEndings("a\r\nb\nc", "a\nnew\nb\nc")).toBe("a\r\nnew\r\nb\nc");
  expect(restoreLineEndings("a\r\nb\r\n", "a\nb\n")).toBe("a\r\nb\r\n");
});
