export type Eol = "\r\n" | "\n";

export interface TextMeta {
  bom: boolean;
  eol: Eol;
}

export interface DecodedText extends TextMeta {
  /** Content with line endings normalized to "\n" and BOM removed. */
  text: string;
  /** Set when the bytes cannot be saved back byte-identically; the file must open read-only. */
  readOnlyReason?: string;
}

const BOM = [0xef, 0xbb, 0xbf];

export function decodeText(bytes: Uint8Array): DecodedText {
  const bom = bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
  const body = bom ? bytes.subarray(3) : bytes;

  let raw: string;
  let readOnlyReason: string | undefined;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    raw = new TextDecoder("utf-8", { ignoreBOM: true }).decode(body);
    readOnlyReason = "not valid UTF-8";
  }

  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const cr = (raw.match(/\r/g) ?? []).length;
  const lf = (raw.match(/\n/g) ?? []).length;
  const eol: Eol = crlf > 0 ? "\r\n" : "\n";
  // Normalizing then re-encoding with a single eol only round-trips if every
  // line ending in the file is the same kind.
  if (!readOnlyReason && (cr !== crlf || (crlf > 0 && lf !== crlf))) {
    readOnlyReason = "mixed line endings";
  }

  const text = raw.replace(/\r\n/g, "\n");
  return readOnlyReason ? { text, bom, eol, readOnlyReason } : { text, bom, eol };
}

export function encodeText(text: string, meta: TextMeta): Uint8Array {
  const body = new TextEncoder().encode(meta.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text);
  if (!meta.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set(BOM, 0);
  out.set(body, 3);
  return out;
}
