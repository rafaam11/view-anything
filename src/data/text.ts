export type TextEncoding = "utf8" | "utf16le" | "utf16be";
export interface DataText { text: string; encoding: TextEncoding; bom: boolean }

/** Decode without normalizing newlines; reject invalid sequences instead of losing bytes. */
export function decodeDataText(bytes: Uint8Array): DataText {
  let encoding: TextEncoding = "utf8", offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf16le"; offset = 2; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf16be"; offset = 2; }
  const body = bytes.subarray(offset);
  if (encoding !== "utf8" && body.length % 2 !== 0) throw new Error("잘못된 UTF-16 파일입니다");
  const text = new TextDecoder(encoding === "utf8" ? "utf-8" : encoding === "utf16le" ? "utf-16le" : "utf-16be", { fatal: true, ignoreBOM: true }).decode(body);
  return { text, encoding, bom: offset !== 0 };
}

export function encodeDataText(data: DataText): Uint8Array {
  // Unpaired surrogates cannot round-trip in UTF-8 or valid UTF-16.
  for (let i = 0; i < data.text.length; i++) {
    const c = data.text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = data.text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("잘못된 유니코드 문자입니다");
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error("잘못된 유니코드 문자입니다");
  }
  if (data.encoding === "utf8") {
    const body = new TextEncoder().encode(data.text);
    if (!data.bom) return body;
    const out = new Uint8Array(body.length + 3); out.set([0xef, 0xbb, 0xbf]); out.set(body, 3); return out;
  }
  const offset = data.bom ? 2 : 0, out = new Uint8Array(offset + data.text.length * 2);
  const little = data.encoding === "utf16le";
  if (data.bom) out.set(little ? [0xff, 0xfe] : [0xfe, 0xff]);
  const view = new DataView(out.buffer);
  for (let i = 0; i < data.text.length; i++) view.setUint16(offset + i * 2, data.text.charCodeAt(i), little);
  return out;
}
