import { expect, test } from "vitest";
import { parseCsv, updateCsv } from "../src/data/csv";

test("cell limit rejects excess fields during parsing, including a trailing empty field", () => {
  expect(parseCsv("a,b", ",", 2)).toHaveLength(1);
  expect(() => parseCsv("a,b,", ",", 2)).toThrow(/초과/);
  expect(() => parseCsv(",".repeat(100_000), ",", 2)).toThrow(/초과/);
});

test("preserves untouched CSV quoting, mixed line endings, and quoted newlines", () => {
  const input = 'id,"label",value\r\n001,"hello\nworld",00042\n2,"a""b",3';
  const rows = parseCsv(input);
  expect(rows.map((r) => r.map((c) => c.value))).toEqual([["id", "label", "value"], ["001", "hello\nworld", "00042"], ["2", 'a"b', "3"]]);
  expect(updateCsv(input, ",", [{ cell: rows[1][2], value: "x,y" }])).toBe('id,"label",value\r\n001,"hello\nworld","x,y"\n2,"a""b",3');
  expect(updateCsv(input, ",", [])).toBe(input);
});

test("handles trailing empty fields and rejects an unterminated quote", () => {
  expect(parseCsv("a,b,")[0].map((c) => c.value)).toEqual(["a", "b", ""]);
  expect(() => parseCsv('"unfinished')).toThrow();});

test("applies multiple changes without changing intervening tokens and rejects duplicate empty fields", () => {
  const input = 'a,"b,b",c\r\nx,y,';
  const rows = parseCsv(input);
  expect(updateCsv(input, ",", [{ cell: rows[1][2], value: "last" }, { cell: rows[0][0], value: "A" }])).toBe('A,"b,b",c\r\nx,y,last');
  expect(() => updateCsv(input, ",", [{ cell: rows[1][2], value: "one" }, { cell: rows[1][2], value: "two" }])).toThrow();
  expect(() => updateCsv(input, "|", [])).toThrow();
});

test("stray quotes are kept literally and still splice byte-exactly", () => {
  const input = 'size,note\r\n5" pipe,"abc" x\r\nend,"q"';
  const rows = parseCsv(input);
  expect(rows.map((r) => r.map((c) => c.value))).toEqual([["size", "note"], ['5" pipe', "abc x"], ["end", "q"]]);
  expect(rows[1][1]).toMatchObject({ start: 19, end: 26 });
  expect(updateCsv(input, ",", [{ cell: rows[1][0], value: "6" }])).toBe('size,note\r\n6,"abc" x\r\nend,"q"');
  expect(updateCsv(input, ",", [])).toBe(input);
});
