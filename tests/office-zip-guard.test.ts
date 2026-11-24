import JSZip from "jszip";
import { expect, test } from "vitest";
import { checkOfficePackage, MAX_ENTRIES } from "../src/office/zip-guard";

async function zip(files: Record<string, string | Uint8Array>, options: JSZip.JSZipGeneratorOptions<"uint8array"> = {}) {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files)) z.file(name, data);
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE", ...options });
}

test("a normal package passes", async () => {
  expect(() => checkOfficePackage(new Uint8Array(0), "Excel")).toThrow(/손상/);
  const bytes = await zip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>" });
  expect(() => checkOfficePackage(bytes, "Excel")).not.toThrow();
});

test("a package with a zip comment still finds its directory", async () => {
  const bytes = await zip({ "a.xml": "<a/>" }, { comment: "x".repeat(1000) });
  expect(() => checkOfficePackage(bytes, "Word")).not.toThrow();
});

test("truncated and non-zip files are reported as broken", async () => {
  const bytes = await zip({ "a.xml": "<a/>".repeat(100) });
  expect(() => checkOfficePackage(bytes.slice(0, bytes.length - 30), "Excel")).toThrow(/손상/);
  expect(() => checkOfficePackage(new TextEncoder().encode("hello, this is not a zip file at all"), "Excel")).toThrow(/손상/);
});

test("encrypted or legacy (OLE compound) files get their own message", () => {
  const cfb = new Uint8Array(512); cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  expect(() => checkOfficePackage(cfb, "PowerPoint")).toThrow(/암호로 보호되었거나 이전 형식/);
});

test("declared sizes over the limit are refused before inflating", async () => {
  const bytes = await zip({ "big.xml": new Uint8Array(1000) });
  // Patch the central directory's uncompressed size to 2 GiB.
  const view = new DataView(bytes.buffer);
  for (let i = bytes.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 2 ** 31, true); break; }
  expect(() => checkOfficePackage(bytes, "Excel")).toThrow(/너무 커서/);
});

test("too many entries are refused", async () => {
  const bytes = await zip({ "a.xml": "a" });
  const view = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  view.setUint16(eocd + 10, Math.min(0xfffe, MAX_ENTRIES + 1), true);
  expect(() => checkOfficePackage(bytes, "Excel")).toThrow(/너무 커서/);
});
