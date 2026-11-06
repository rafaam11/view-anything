import { decodeDataText, encodeDataText, type DataText } from "../data/text";
import { platform } from "../platform";

export type TextMeta = DataText | { text: string; encoding: "cp949"; bom: false };
export const normalize = (text: string) => text.replace(/\r\n|\r/g, "\n");

/** Why bytes could not be shown as text: `encoding` may be solved by choosing CP949, `binary` cannot. */
export class TextDecodeError extends Error {
  constructor(message: string, readonly kind: "binary" | "encoding") { super(message); }
}

/** Control characters other than tab, newlines, form feed and ESC (ANSI colour codes in logs) mean binary. */
export function validateText(text: string): void {
  if (/[\x00-\x08\x0b\x0e-\x1a\x1c-\x1f\x7f]/.test(text)) throw new TextDecodeError("바이너리 또는 지원하지 않는 텍스트입니다.", "binary");
}

function decodeUtf(bytes: Uint8Array): DataText {
  try { return decodeDataText(bytes); }
  catch { throw new TextDecodeError("UTF-8/UTF-16으로 읽을 수 없습니다.", "encoding"); }
}

export async function decodeText(bytes: Uint8Array, cp949: boolean): Promise<TextMeta> {
  const meta: TextMeta = cp949 ? { text: await platform.decodeCp949(bytes), encoding: "cp949", bom: false } : decodeUtf(bytes);
  validateText(meta.text);
  return meta;
}

export function lineEndings(text: string): { mixed: boolean; ending: string } {
  const endings = new Set(text.match(/\r\n|\r|\n/g) ?? []);
  return { mixed: endings.size > 1, ending: endings.values().next().value ?? "\n" };
}

export async function encodeText(meta: TextMeta, value: string): Promise<Uint8Array> {
  const { mixed, ending } = lineEndings(meta.text);
  if (mixed) throw new Error("줄바꿈이 섞인 파일은 읽기 전용입니다.");
  const text = normalize(value).replace(/\n/g, ending);
  validateText(text);
  const bytes = meta.encoding === "cp949" ? await platform.encodeCp949(text) : encodeDataText({ ...meta, text });
  if (bytes.length > 10 * 1024 * 1024) throw new Error("편집 결과가 10 MiB를 초과합니다. 편집 내용을 유지합니다.");
  return bytes;
}
