// Base64 for the GLB embedded in an exported HTML file. No dependencies: the exported runtime
// decodes with it too.

/** Bytes per String.fromCharCode call (keeps the argument list well under engine limits). */
const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  // A multiple of 3, so every chunk but the last encodes without padding and they concatenate.
  const step = CHUNK - (CHUNK % 3);
  for (let i = 0; i < bytes.length; i += step) {
    parts.push(btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[])));
  }
  return parts.join("");
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
