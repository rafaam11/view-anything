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

test("handles trailing empty fields and rejects malformed quoted fields", () => {
  expect(parseCsv("a,b,")[0].map((c) => c.value)).toEqual(["a", "b", ""]);
  expect(() => parseCsv('"unfinished')).toThrow();
  expect(() => parseCsv('"x"bad')).toThrow();
});

test("applies multiple changes without changing intervening tokens and rejects duplicate empty fields", () => {
  const input = 'a,"b,b",c\r\nx,y,';
  const rows = parseCsv(input);
  expect(updateCsv(input, ",", [{ cell: rows[1][2], value: "last" }, { cell: rows[0][0], value: "A" }])).toBe('A,"b,b",c\r\nx,y,last');
  expect(() => updateCsv(input, ",", [{ cell: rows[1][2], value: "one" }, { cell: rows[1][2], value: "two" }])).toThrow();
  expect(() => updateCsv(input, "|", [])).toThrow();
});
