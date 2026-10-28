/** CSV token ranges refer to the original text, including a field's quotes. */
export interface CsvCell { value: string; start: number; end: number }
export type CsvRows = CsvCell[][];

/** Parse without normalizing line endings or reserializing unchanged fields. */
export function parseCsv(source: string, delimiter = ","): CsvRows {
  if (![",", "\t", ";"].includes(delimiter)) throw new Error("지원하지 않는 구분자입니다");
  if (!source.length) return [];
  const rows: CsvRows = []; let row: CsvCell[] = []; let pos = 0;
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
    row.push({ value, start, end: pos });
    if (source[pos] === delimiter) {
      pos++;
      if (pos === source.length) row.push({ value: "", start: pos, end: pos });
    } else {
      if (source[pos] === "\r" && source[pos + 1] === "\n") pos += 2;
      else if (pos < source.length) pos++;
      rows.push(row); row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Apply non-overlapping cell changes from right to left to retain untouched bytes. */
export function updateCsv(source: string, delimiter: string, changes: { cell: CsvCell; value: string }[]): string {
  const ordered = [...changes].sort((a, b) => b.cell.start - a.cell.start);
  let result = source; let boundary = source.length + 1;
  for (const { cell, value } of ordered) {
    if (cell.start < 0 || cell.end < cell.start || cell.end > source.length || cell.end > boundary) throw new Error("CSV 셀 범위 오류");
    const encoded = value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    result = result.slice(0, cell.start) + encoded + result.slice(cell.end); boundary = cell.start;
  }
  return result;
}
