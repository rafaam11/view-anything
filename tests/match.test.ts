import { expect, test } from "vitest";
import { matchRanges } from "../src/ui/match";

test("matches literally and ignores case", () => {
  expect(matchRanges("Hello hello HELLO", "hello")).toEqual([[0, 5], [6, 11], [12, 17]]);
  expect(matchRanges("a.b axb", "a.b")).toEqual([[0, 3]]);
  expect(matchRanges("(x) [y] $z\\", "[y]")).toEqual([[4, 7]]);
  expect(matchRanges("c:\\dir", "\\d")).toEqual([[2, 4]]);
});

test("an empty query and a missing term find nothing", () => {
  expect(matchRanges("anything", "")).toEqual([]);
  expect(matchRanges("anything", "zzz")).toEqual([]);
});

test("offsets stay in UTF-16 units across astral characters", () => {
  expect(matchRanges("😀한글😀한글", "한글")).toEqual([[2, 4], [6, 8]]);
});

test("stops at the match limit", () => {
  expect(matchRanges("a".repeat(20000), "a")).toHaveLength(10000);
});
