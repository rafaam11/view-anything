import { decodeDataText, encodeDataText, type DataText } from "../data/text";
import { platform } from "../platform";

export type TextMeta = DataText | { text: string; encoding: "cp949"; bom: false };
export const normalize = (text: string) => text.replace(/\r\n|\r/g, "\n");

/** Why bytes could not be shown as text: `encoding` may be solved by choosing CP949, `binary` cannot. */
export class TextDecodeError extends Error {
  constructor(message: string, readonly kind: "binary" | "encoding") { super(message); }
}

/**
 * Control characters mean binary, except the ones real text files carry: tab, LF, VT (in-cell
 * line breaks from some exports), FF, CR, SUB (the DOS end-of-file mark) and ESC (ANSI colours).
 */
export function validateText(text: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting control characters is the point of this check
  if (/[\x00-\x08\x0e-\x19\x1c-\x1f\x7f]/.test(text)) throw new TextDecodeError("바이너리 또는 지원하지 않는 텍스트입니다.", "binary");
}

/** UTF-8/UTF-16 decode whose failure is a `TextDecodeError`, for viewers without a CP949 option. */
export function decodeUtfText(bytes: Uint8Array): DataText {
  try { return decodeDataText(bytes); }
  catch { throw new TextDecodeError("UTF-8/UTF-16으로 읽을 수 없습니다.", "encoding"); }
}

export async function decodeText(bytes: Uint8Array, cp949: boolean): Promise<TextMeta> {
  const meta: TextMeta = cp949 ? { text: await platform.decodeCp949(bytes), encoding: "cp949", bom: false } : decodeUtfText(bytes);
  validateText(meta.text);
  return meta;
}

/** Encode text whose line endings are already final (CSV splices keep the original ones). */
export async function encodeRaw(meta: TextMeta, text: string): Promise<Uint8Array> {
  return meta.encoding === "cp949" ? platform.encodeCp949(text) : encodeDataText({ ...meta, text });
}

/** What to tell the reader: the CP949 setting solves `encoding` failures, nothing solves `binary`. */
export function decodeHint(e: unknown): string {
  if (!(e instanceof TextDecodeError)) return String(e);
  return e.kind === "encoding" ? `${e.message} 설정(Ctrl+,) > 문자 인코딩에서 CP949를 선택하세요.` : e.message;
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
