import { expect, test } from "vitest";
import { decodeText, encodeText } from "../src/md/text";

const enc = (s: string) => new TextEncoder().encode(s);
const BOM = [0xef, 0xbb, 0xbf];

test("decodeText detects BOM and CRLF, encodeText round-trips bytes", () => {
  const bytes = new Uint8Array([...BOM, ...enc("# 한\r\n\r\nx")]);
  const d = decodeText(bytes);
  expect(d).toMatchObject({ bom: true, eol: "\r\n", text: "# 한\n\nx" });
  expect(d.readOnlyReason).toBeUndefined();
  expect(encodeText(d.text, d)).toEqual(bytes);
});

test("plain LF without BOM round-trips", () => {
  const bytes = enc("a\n\nb\n");
  const d = decodeText(bytes);
  expect(d).toMatchObject({ bom: false, eol: "\n", text: "a\n\nb\n" });
  expect(encodeText(d.text, d)).toEqual(bytes);
});

test("empty input decodes to empty LF text", () => {
  const d = decodeText(new Uint8Array([]));
  expect(d).toMatchObject({ bom: false, eol: "\n", text: "" });
  expect(d.readOnlyReason).toBeUndefined();
  expect(encodeText(d.text, d)).toEqual(new Uint8Array([]));
});

test("non-utf8 bytes are read-only", () => {
  expect(decodeText(new Uint8Array([0xc7, 0xd1])).readOnlyReason).toBeTruthy();
});

test("mixed line endings are read-only (cannot round-trip)", () => {
  expect(decodeText(enc("a\r\nb\nc")).readOnlyReason).toBeTruthy();
  expect(decodeText(enc("a\rb")).readOnlyReason).toBeTruthy();
});
