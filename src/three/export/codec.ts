// Base64 for the GLB embedded in an exported HTML file. No dependencies: the exported runtime
// decodes with it too.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CODES = Uint8Array.from(ALPHABET, (c) => c.charCodeAt(0));
const PAD = "=".charCodeAt(0);

/** Base64 text length of `n` bytes (with padding). */
export function base64Length(n: number): number {
  return Math.ceil(n / 3) * 4;
}

/**
 * Write `bytes` as base64 ASCII into `out` at `offset` (no intermediate string, so a big GLB
 * never becomes one huge JS string). Returns the offset after the last written byte.
 */
export function encodeBase64Into(bytes: Uint8Array, out: Uint8Array, offset: number): number {
  let o = offset;
  const n = bytes.length;
  const whole = n - (n % 3);
  for (let i = 0; i < whole; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = CODES[v >> 18];
    out[o++] = CODES[(v >> 12) & 63];
    out[o++] = CODES[(v >> 6) & 63];
    out[o++] = CODES[v & 63];
  }
  if (n % 3 === 1) {
    const v = bytes[whole] << 16;
    out[o++] = CODES[v >> 18];
    out[o++] = CODES[(v >> 12) & 63];
    out[o++] = PAD;
    out[o++] = PAD;
  } else if (n % 3 === 2) {
    const v = (bytes[whole] << 16) | (bytes[whole + 1] << 8);
    out[o++] = CODES[v >> 18];
    out[o++] = CODES[(v >> 12) & 63];
    out[o++] = CODES[(v >> 6) & 63];
    out[o++] = PAD;
  }
  return o;
}

export function toBase64(bytes: Uint8Array): string {
  const out = new Uint8Array(base64Length(bytes.length));
  encodeBase64Into(bytes, out, 0);
  return new TextDecoder().decode(out);
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
