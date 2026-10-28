/** CSV token ranges refer to the original text, including a field's quotes. */
export interface CsvCell { value: string; start: number; end: number }
export type CsvRows = CsvCell[][];

/** Parse without normalizing line endings or reserializing unchanged fields. */
export function parseCsv(source: string, delimiter = ",", maxCells = Infinity): CsvRows {
  if (![",", "\t", ";"].includes(delimiter)) throw new Error("지원하지 않는 구분자입니다");
  if (!(maxCells >= 0)) throw new Error("CSV 셀 한도 오류");
  if (!source.length) return [];
  const rows: CsvRows = []; let row: CsvCell[] = []; let pos = 0; let count = 0;
  const add = (cell: CsvCell) => {
    if (++count > maxCells) throw new Error(`CSV 셀이 ${maxCells.toLocaleString()}개를 초과합니다.`);
    row.push(cell);
  };
  while (pos < source.length) {
    const start = pos; let value = "";
    if (source[pos] === '"') {
      pos++; let closed = false;
      while (pos < source.length) {
        if (source[pos] !== '"') { value += source[pos++]; continue; }
        if (source[pos + 1] === '"') { value += '"'; pos += 2; continue; }
        pos++; closed = true; break;
      }
      if (!closed || (pos < source.length && source[pos] !== delimiter && source[pos] !== "\r" && source[pos] !== "\n")) throw new Error("CSV 인용부호 오류");
    } else {
      while (pos < source.length && source[pos] !== delimiter && source[pos] !== "\r" && source[pos] !== "\n") {
        if (source[pos] === '"') throw new Error("CSV 인용부호 오류");
        value += source[pos++];
      }
    }
    add({ value, start, end: pos });
    if (source[pos] === delimiter) {
      pos++;
      if (pos === source.length) add({ value: "", start: pos, end: pos });
    } else {
      if (source[pos] === "\r" && source[pos + 1] === "\n") pos += 2;
      else if (pos < source.length) pos++;
      rows.push(row); row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Apply non-overlapping cell changes in one pass to retain untouched text. */
export function updateCsv(source: string, delimiter: string, changes: { cell: CsvCell; value: string }[]): string {
  if (![",", "\t", ";"].includes(delimiter)) throw new Error("지원하지 않는 구분자입니다");
  const ordered = [...changes].sort((a, b) => a.cell.start - b.cell.start);
  const chunks: string[] = []; let boundary = 0; let previousStart = -1;
  for (const { cell, value } of ordered) {
    if (!Number.isInteger(cell.start) || !Number.isInteger(cell.end) || cell.start < boundary || cell.start === previousStart || cell.end < cell.start || cell.end > source.length) throw new Error("CSV 셀 범위 오류");
    const encoded = value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    chunks.push(source.slice(boundary, cell.start), encoded); boundary = cell.end; previousStart = cell.start;
  }
  chunks.push(source.slice(boundary)); return chunks.join("");
}
