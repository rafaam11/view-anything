import { expect, test } from "vitest";
import { decodeDataText, encodeDataText } from "../src/data/text";

test.each(["utf8", "utf16le", "utf16be"] as const)("%s preserves BOM, Unicode and mixed newlines", (encoding) => {
  const bytes = encodeDataText({ text: "한글😀\r\n둘\n셋\r", encoding, bom: true });
  const decoded = decodeDataText(bytes);
  expect(decoded).toEqual({ text: "한글😀\r\n둘\n셋\r", encoding, bom: true });
  expect(encodeDataText(decoded)).toEqual(bytes);
});
test("rejects invalid bytes and unpaired surrogates", () => {
  expect(() => decodeDataText(new Uint8Array([0xff, 0xfe, 0x61]))).toThrow();
  expect(() => decodeDataText(new Uint8Array([0xc0, 0xaf]))).toThrow();
  expect(() => encodeDataText({ text: "\ud800", encoding: "utf8", bom: false })).toThrow();
});
