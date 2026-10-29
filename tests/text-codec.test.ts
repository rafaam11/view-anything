import { expect, test, vi } from "vitest";
vi.mock("../src/platform", () => ({ platform: { decodeCp949: vi.fn(), encodeCp949: vi.fn() } }));
import { decodeText, encodeText, lineEndings } from "../src/text/codec";
import { encodeDataText } from "../src/data/text";
import { platform } from "../src/platform";

test.each(["utf8", "utf16le", "utf16be"] as const)("preserves %s, BOM and CRLF", async encoding => {
  const bytes = encodeDataText({ text: "한글\r\nnext\r\n", encoding, bom: true });
  const meta = await decodeText(bytes, false);
  expect(await encodeText(meta, "한글\nnext\n")).toEqual(bytes);
  const edited = await decodeText(await encodeText(meta, "한글\nchanged\n"), false);
  expect(edited.text).toBe("한글\r\nchanged\r\n");
});
test("rejects binary and invalid UTF without guessing CP949", async () => {
  await expect(decodeText(new Uint8Array([0x41, 0, 0x42]), false)).rejects.toThrow("바이너리");
  await expect(decodeText(new Uint8Array([0xc7, 0xd1]), false)).rejects.toThrow();
  expect(platform.decodeCp949).not.toHaveBeenCalled();
});
test("mixed endings cannot be edited; uniform CR and empty text round trip", async () => {
  expect(lineEndings("a\r\nb\nc").mixed).toBe(true);
  await expect(encodeText({ text: "a\r\nb\nc", encoding: "utf8", bom: false }, "x")).rejects.toThrow("읽기 전용");
  const meta = { text: "a\rb\r", encoding: "utf8" as const, bom: false };
  expect(new TextDecoder().decode(await encodeText(meta, "a\nc\n"))).toBe("a\rc\r");
  expect(await encodeText({ ...meta, text: "" }, "")).toHaveLength(0);
});
test("CP949 is only explicit and encoding errors propagate", async () => {
  vi.mocked(platform.decodeCp949).mockResolvedValue("한글");
  const bytes = new Uint8Array([0xc7, 0xd1]);
  const meta = await decodeText(bytes, true);
  expect(platform.decodeCp949).toHaveBeenCalledWith(bytes);
  vi.mocked(platform.encodeCp949).mockRejectedValue(new Error("CP949로 저장할 수 없는 문자"));
  await expect(encodeText(meta, "😀")).rejects.toThrow("CP949");
});
test("edited files cannot exceed the viewer limit", async () => {
  await expect(encodeText({ text: "", encoding: "utf8", bom: false }, "x".repeat(10 * 1024 * 1024 + 1))).rejects.toThrow("10 MiB");
});
