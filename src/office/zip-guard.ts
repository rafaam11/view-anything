/**
 * Checks an OOXML package before any of it is inflated: the ZIP's central directory must be
 * readable, hold at most MAX_ENTRIES entries and declare at most MAX_UNCOMPRESSED bytes in all.
 * Password-protected Office files are not ZIPs but OLE compound files; they get their own message.
 * The declared sizes are what the file claims; the inflater still allocates what the data really
 * expands to, so this is a guard against honest-looking bombs and broken files, not a hard cap.
 */
export const MAX_ENTRIES = 20_000;
export const MAX_UNCOMPRESSED = 1024 * 1024 * 1024;

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function checkOfficePackage(bytes: Uint8Array, kind: string): void {
  if (CFB.every((b, i) => bytes[i] === b)) throw new Error(`암호로 보호되었거나 이전 형식인 ${kind} 문서는 열 수 없습니다.`);
  const broken = () => new Error(`${kind} 파일이 손상되었거나 올바른 형식이 아닙니다.`);
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw broken();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22, stop = Math.max(0, bytes.length - 22 - 0xffff); i >= stop; i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw broken();
  let entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR) throw broken();
    const record = Number(view.getBigUint64(locator + 8, true));
    if (record + 56 > bytes.length || view.getUint32(record, true) !== ZIP64_EOCD) throw broken();
    const count = view.getBigUint64(record + 32, true), start = view.getBigUint64(record + 48, true);
    if (count > BigInt(MAX_ENTRIES)) throw tooBig(kind);
    entries = Number(count); offset = Number(start);
  }
  if (entries > MAX_ENTRIES) throw tooBig(kind);
  let total = 0;
  for (let n = 0, at = offset; n < entries; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw broken();
    const size = view.getUint32(at + 24, true);
    // 0xffffffff means the real size is in a ZIP64 extra field: 4 GiB or more, over the limit anyway.
    total += size;
    if (size === 0xffffffff || total > MAX_UNCOMPRESSED) throw tooBig(kind);
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
}

function tooBig(kind: string) {
  return new Error(`${kind} 파일의 압축을 풀면 너무 커서 열 수 없습니다.`);
}
