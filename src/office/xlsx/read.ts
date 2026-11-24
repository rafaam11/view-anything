import JSZip from "jszip";
import { format as formatNumber, get_table } from "ssf";

/**
 * A small read-only SpreadsheetML (xlsx) reader: sheet names and order, cell values as Excel shows
 * them (stored values and formula results, formatted with the cell's number format), and the parts
 * of the cell style that decide how a sheet looks (font, solid fill, borders, alignment), column
 * widths, row heights, merged cells and frozen panes. Formulas are not recalculated.
 */
export type Border = { style: string; color: string | null };
export type CellStyle = {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
  color?: string; size?: number; font?: string; fill?: string;
  horizontal?: string; vertical?: string; wrap?: boolean; indent?: number;
  top?: Border; right?: Border; bottom?: Border; left?: Border;
};
export type Cell = { text: string; style: number; number: boolean };
export type Merge = { r1: number; c1: number; r2: number; c2: number };
export type Sheet = {
  name: string;
  /** Sparse rows by zero-based index; each row maps zero-based columns to cells. */
  rows: Map<number, Map<number, Cell>>;
  /** Rows and columns in use (one past the last index with a cell, width or merge). */
  rowCount: number; columnCount: number;
  columnWidths: Map<number, number>; rowHeights: Map<number, number>;
  defaultColumnWidth: number; defaultRowHeight: number;
  hiddenRows: Set<number>; hiddenColumns: Set<number>;
  merges: Merge[];
  frozenRows: number; frozenColumns: number;
  gridLines: boolean;
  /** Cells past `maxCells` were dropped. */
  truncated: boolean;
};
export type SheetEntry = { name: string; load(): Promise<Sheet> };
export type Workbook = { sheets: SheetEntry[]; styles: CellStyle[]; hiddenSheets: number };

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const STRICT_REL = "http://purl.oclc.org/ooxml/officeDocument/relationships";
/** Default Calibri 11 maximum digit width in px, used by Excel's column-width formula. */
const DIGIT = 7;

export async function readWorkbook(bytes: Uint8Array, maxCells = 1_000_000): Promise<Workbook> {
  const zip = await JSZip.loadAsync(bytes);
  const workbookPath = await officeDocumentPath(zip);
  const workbook = await xml(zip, workbookPath);
  if (!workbook) throw new Error("통합 문서(workbook.xml)가 없습니다.");
  const rels = await relationships(zip, workbookPath);
  const date1904 = ["1", "true"].includes(first(workbook, "workbookPr")?.getAttribute("date1904") ?? "");
  const theme = await themeColors(zip, rels);
  const shared = await sharedStrings(zip, rels);
  const { styles, formats } = await readStyles(zip, rels, theme);
  let hiddenSheets = 0;
  const sheets: SheetEntry[] = [];
  for (const node of all(workbook, "sheet")) {
    const state = node.getAttribute("state");
    if (state === "hidden" || state === "veryHidden") { hiddenSheets++; continue; }
    const id = [...node.attributes].find(a => a.namespaceURI === REL || a.namespaceURI === STRICT_REL ? a.localName === "id" : /^[^:]+:id$/.test(a.name))?.value;
    const target = id ? rels.get(id) : undefined;
    if (!target || !/\/worksheet$/.test(target.type)) continue; // chart sheets and dialog sheets have no cells
    const name = node.getAttribute("name") ?? `Sheet${sheets.length + 1}`;
    let loaded: Promise<Sheet> | null = null;
    sheets.push({
      name,
      load: () => loaded ??= (async () => {
        const doc = await xml(zip, target.path);
        if (!doc) throw new Error(`시트를 찾을 수 없습니다: ${name}`);
        return readSheet(doc, name, { shared, formats, date1904, maxCells });
      })(),
    });
  }
  if (!sheets.length) throw new Error("표시할 워크시트가 없습니다.");
  return { sheets, styles, hiddenSheets };
}

type Context = { shared: string[]; formats: (string | null)[]; date1904: boolean; maxCells: number };

export function readSheet(doc: Document, name: string, context: Context): Sheet {
  const format = first(doc, "sheetFormatPr");
  const baseWidth = num(format?.getAttribute("baseColWidth")) ?? 8;
  const defaultWidth = num(format?.getAttribute("defaultColWidth"));
  const sheet: Sheet = {
    name, rows: new Map(), rowCount: 0, columnCount: 0,
    columnWidths: new Map(), rowHeights: new Map(),
    defaultColumnWidth: defaultWidth !== undefined ? widthPx(defaultWidth) : Math.round(baseWidth * DIGIT + 8),
    defaultRowHeight: ptPx(num(format?.getAttribute("defaultRowHeight")) ?? 15),
    hiddenRows: new Set(), hiddenColumns: new Set(), merges: [],
    frozenRows: 0, frozenColumns: 0, gridLines: true, truncated: false,
  };
  const view = first(doc, "sheetView");
  if (view?.getAttribute("showGridLines") === "0" || view?.getAttribute("showGridLines") === "false") sheet.gridLines = false;
  const pane = view ? first(view, "pane") : null;
  if (pane && (pane.getAttribute("state") === "frozen" || pane.getAttribute("state") === "frozenSplit")) {
    sheet.frozenRows = Math.trunc(num(pane.getAttribute("ySplit")) ?? 0);
    sheet.frozenColumns = Math.trunc(num(pane.getAttribute("xSplit")) ?? 0);
  }
  for (const col of all(doc, "col")) {
    const min = Math.trunc(num(col.getAttribute("min")) ?? 0), max = Math.min(16384, Math.trunc(num(col.getAttribute("max")) ?? 0));
    const width = num(col.getAttribute("width"));
    const hidden = truthy(col.getAttribute("hidden"));
    for (let c = min - 1; c < max && c >= 0; c++) {
      if (width !== undefined) sheet.columnWidths.set(c, widthPx(width));
      if (hidden) sheet.hiddenColumns.add(c);
    }
  }
  let cells = 0, rowIndex = -1;
  for (const row of all(doc, "row")) {
    rowIndex = (num(row.getAttribute("r")) ?? rowIndex + 2) - 1;
    if (rowIndex < 0 || rowIndex >= 1_048_576) continue;
    const height = num(row.getAttribute("ht"));
    if (height !== undefined) sheet.rowHeights.set(rowIndex, ptPx(height));
    if (truthy(row.getAttribute("hidden"))) sheet.hiddenRows.add(rowIndex);
    const rowStyle = truthy(row.getAttribute("customFormat")) ? Math.trunc(num(row.getAttribute("s")) ?? 0) : 0;
    let column = -1;
    let target: Map<number, Cell> | undefined;
    for (const c of children(row, "c")) {
      const ref = c.getAttribute("r");
      const parsed = ref ? parseRef(ref) : null;
      column = parsed ? parsed.column : column + 1;
      if (column < 0 || column >= 16384) continue;
      const style = Math.trunc(num(c.getAttribute("s")) ?? rowStyle);
      const text = cellText(c, context, style);
      if (text === null && style === 0) continue;
      if (cells >= context.maxCells) { sheet.truncated = true; break; }
      cells++;
      if (!target) { target = new Map(); sheet.rows.set(rowIndex, target); }
      target.set(column, { text: text ?? "", style, number: (c.getAttribute("t") ?? "n") === "n" && text !== null });
      sheet.columnCount = Math.max(sheet.columnCount, column + 1);
    }
    if (target || sheet.rowHeights.has(rowIndex)) sheet.rowCount = Math.max(sheet.rowCount, rowIndex + 1);
    if (sheet.truncated) break;
  }
  for (const merge of all(doc, "mergeCell")) {
    const [a, b] = (merge.getAttribute("ref") ?? "").split(":").map(parseRef);
    if (!a || !b) continue;
    const m = { r1: Math.min(a.row, b.row), c1: Math.min(a.column, b.column), r2: Math.max(a.row, b.row), c2: Math.max(a.column, b.column) };
    if (m.r2 >= 1_048_576 || m.c2 >= 16384) continue;
    sheet.merges.push(m);
    sheet.rowCount = Math.max(sheet.rowCount, m.r2 + 1); sheet.columnCount = Math.max(sheet.columnCount, m.c2 + 1);
  }
  return sheet;
}

function cellText(c: Element, { shared, formats, date1904 }: Context, style: number): string | null {
  const type = c.getAttribute("t") ?? "n";
  if (type === "inlineStr") { const is = first(c, "is"); return is ? richText(is) : ""; }
  const v = first(c, "v")?.textContent ?? null;
  if (v === null) return null;
  switch (type) {
    case "s": return shared[Math.trunc(Number(v))] ?? "";
    case "b": return v === "1" || v === "true" ? "TRUE" : "FALSE";
    case "str": case "e": case "d": return v;
    default: {
      const value = Number(v);
      if (!Number.isFinite(value)) return v;
      const code = formats[style] ?? "General";
      try { return formatNumber(code, value, { date1904 }); } catch { return String(value); }
    }
  }
}

/** The text of a shared or inline string: its runs joined, phonetic guides (rPh) left out. */
function richText(node: Element): string {
  let out = "";
  for (const t of all(node, "t")) {
    const parent = t.parentNode as Element | null;
    if (parent && parent.nodeType === 1 && local(parent) === "rPh") continue;
    out += t.textContent ?? "";
  }
  return out;
}

async function sharedStrings(zip: JSZip, rels: Rels): Promise<string[]> {
  const path = [...rels.values()].find(r => /\/sharedStrings$/.test(r.type))?.path;
  const doc = path ? await xml(zip, path) : null;
  return doc ? children(doc.documentElement, "si").map(richText) : [];
}

async function readStyles(zip: JSZip, rels: Rels, theme: string[]): Promise<{ styles: CellStyle[]; formats: (string | null)[] }> {
  const path = [...rels.values()].find(r => /\/styles$/.test(r.type))?.path;
  const doc = path ? await xml(zip, path) : null;
  if (!doc) return { styles: [{}], formats: [null] };
  const custom = new Map<number, string>();
  for (const f of all(doc, "numFmt")) {
    const id = num(f.getAttribute("numFmtId")), code = f.getAttribute("formatCode");
    if (id !== undefined && code !== null) custom.set(id, code);
  }
  const builtIn = get_table();
  const colors = indexedColors(doc);
  const color = (node: Element | null) => node ? resolveColor(node, theme, colors) : null;
  const section = (name: string, item: string) => { const s = first(doc, name); return s ? children(s, item) : []; };
  const fonts = section("fonts", "font").map((f): CellStyle => {
    const out: CellStyle = {};
    const flag = (name: string) => { const n = first(f, name); return !!n && n.getAttribute("val") !== "0" && n.getAttribute("val") !== "false"; };
    if (flag("b")) out.bold = true;
    if (flag("i")) out.italic = true;
    if (first(f, "u") && first(f, "u")?.getAttribute("val") !== "none") out.underline = true;
    if (flag("strike")) out.strike = true;
    const size = num(first(f, "sz")?.getAttribute("val")); if (size) out.size = size;
    const name = first(f, "name")?.getAttribute("val"); if (name) out.font = name;
    const c = color(first(f, "color")); if (c) out.color = c;
    return out;
  });
  const fills = section("fills", "fill").map(f => {
    const pattern = first(f, "patternFill");
    if (!pattern || (pattern.getAttribute("patternType") ?? "none") === "none") return null;
    return color(first(pattern, "fgColor")) ?? color(first(pattern, "bgColor"));
  });
  const borders = section("borders", "border").map(b => {
    const out: Partial<Record<"top" | "right" | "bottom" | "left", Border>> = {};
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const node = children(b, side)[0] ?? (side === "left" ? children(b, "start")[0] : side === "right" ? children(b, "end")[0] : undefined);
      const style = node?.getAttribute("style");
      if (node && style && style !== "none") out[side] = { style, color: color(first(node, "color")) };
    }
    return out;
  });
  const styles: CellStyle[] = [], formats: (string | null)[] = [];
  for (const xf of section("cellXfs", "xf")) {
    const id = Math.trunc(num(xf.getAttribute("numFmtId")) ?? 0);
    formats.push(custom.get(id) ?? builtIn[id] ?? null);
    const style: CellStyle = { ...fonts[Math.trunc(num(xf.getAttribute("fontId")) ?? 0)] };
    const fill = fills[Math.trunc(num(xf.getAttribute("fillId")) ?? 0)]; if (fill) style.fill = fill;
    Object.assign(style, borders[Math.trunc(num(xf.getAttribute("borderId")) ?? 0)]);
    const align = first(xf, "alignment");
    if (align) {
      const h = align.getAttribute("horizontal"); if (h && h !== "general") style.horizontal = h;
      const v = align.getAttribute("vertical"); if (v) style.vertical = v;
      if (truthy(align.getAttribute("wrapText"))) style.wrap = true;
      const indent = num(align.getAttribute("indent")); if (indent) style.indent = indent;
    }
    styles.push(style);
  }
  if (!styles.length) { styles.push({ ...fonts[0] }); formats.push(null); }
  return { styles, formats };
}

/** Theme colours in Excel's index order: lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink. */
async function themeColors(zip: JSZip, rels: Rels): Promise<string[]> {
  const path = [...rels.values()].find(r => /\/theme$/.test(r.type))?.path;
  const doc = path ? await xml(zip, path) : null;
  const scheme = doc ? first(doc, "clrScheme") : null;
  if (!scheme) return [];
  const list = [...scheme.children].map(node => {
    const srgb = first(node, "srgbClr")?.getAttribute("val");
    const sys = first(node, "sysClr")?.getAttribute("lastClr");
    const hex = srgb ?? sys;
    return hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : "#000000";
  });
  [list[0], list[1], list[2], list[3]] = [list[1], list[0], list[3], list[2]];
  return list;
}

const INDEXED = [
  "000000", "ffffff", "ff0000", "00ff00", "0000ff", "ffff00", "ff00ff", "00ffff",
  "000000", "ffffff", "ff0000", "00ff00", "0000ff", "ffff00", "ff00ff", "00ffff",
  "800000", "008000", "000080", "808000", "800080", "008080", "c0c0c0", "808080",
  "9999ff", "993366", "ffffcc", "ccffff", "660066", "ff8080", "0066cc", "ccccff",
  "000080", "ff00ff", "ffff00", "00ffff", "800080", "800000", "008080", "0000ff",
  "00ccff", "ccffff", "ccffcc", "ffff99", "99ccff", "ff99cc", "cc99ff", "ffcc99",
  "3366ff", "33cccc", "99cc00", "ffcc00", "ff9900", "ff6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

function indexedColors(styles: Document): string[] {
  const custom = first(styles, "indexedColors");
  const list = custom ? children(custom, "rgbColor").map(c => (c.getAttribute("rgb") ?? "FF000000").slice(-6).toLowerCase()) : INDEXED;
  return list.map(c => `#${c}`);
}

function resolveColor(node: Element, theme: string[], indexed: string[]): string | null {
  if (truthy(node.getAttribute("auto"))) return null;
  let hex: string | null = null;
  const rgb = node.getAttribute("rgb");
  const index = num(node.getAttribute("indexed"));
  const themeIndex = num(node.getAttribute("theme"));
  if (rgb && /^[0-9a-f]{6,8}$/i.test(rgb)) hex = `#${rgb.slice(-6).toLowerCase()}`;
  else if (themeIndex !== undefined) hex = theme[themeIndex] ?? null;
  else if (index !== undefined) hex = index === 64 ? null : index === 65 ? "#ffffff" : indexed[index] ?? null;
  if (!hex) return null;
  const tint = num(node.getAttribute("tint"));
  return tint ? applyTint(hex, tint) : hex;
}

/** Excel's tint: scales HSL lightness toward black (negative) or white (positive). */
export function applyTint(hex: string, tint: number): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let out: number[];
  if (s === 0) out = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    out = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return `#${out.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** "B3" → { row: 2, column: 1 }; null for anything else. */
export function parseRef(ref: string): { row: number; column: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(ref.trim());
  if (!m) return null;
  let column = 0;
  for (const ch of m[1].toUpperCase()) column = column * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]) - 1, column: column - 1 };
}

export function columnName(column: number): string {
  let name = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Excel stores widths in characters of the default font's widest digit; this is its px formula. */
function widthPx(chars: number): number {
  return Math.max(0, Math.trunc(((256 * chars + Math.trunc(128 / DIGIT)) / 256) * DIGIT));
}

function ptPx(points: number): number {
  return Math.round((points * 96) / 72);
}

type Rels = Map<string, { type: string; path: string }>;

async function officeDocumentPath(zip: JSZip): Promise<string> {
  const root = await relationships(zip, "");
  return [...root.values()].find(r => /\/officeDocument$/.test(r.type))?.path ?? "xl/workbook.xml";
}

async function relationships(zip: JSZip, part: string): Promise<Rels> {
  const dir = part.includes("/") ? part.slice(0, part.lastIndexOf("/") + 1) : "";
  const file = part ? `${dir}_rels/${part.slice(dir.length)}.rels` : "_rels/.rels";
  const doc = await xml(zip, file);
  const out: Rels = new Map();
  if (!doc) return out;
  for (const r of all(doc, "Relationship")) {
    const id = r.getAttribute("Id"), target = r.getAttribute("Target"), type = r.getAttribute("Type") ?? "";
    if (!id || !target || r.getAttribute("TargetMode") === "External") continue;
    out.set(id, { type, path: resolvePath(dir, target) });
  }
  return out;
}

function resolvePath(dir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
  return out.join("/");
}

async function xml(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path) ?? zip.file(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"))[0];
  if (!file) return null;
  const doc = new DOMParser().parseFromString(await file.async("string"), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error(`XML을 읽을 수 없습니다: ${path}`);
  return doc;
}

/** Element name without its prefix (`x:row` → `row`); DOM implementations differ on namespaces. */
function local(e: Element): string {
  const name = e.localName;
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}
/** Descendants named `name`, in document order; stops at the first match when `one`. */
function walk(node: Document | Element, name: string, one: boolean): Element[] {
  const out: Element[] = [];
  const start = "documentElement" in node ? node.documentElement : node;
  if (!start) return out;
  const stack: Element[] = "documentElement" in node ? [start] : [...start.children].reverse();
  while (stack.length) {
    const e = stack.pop() as Element;
    if (local(e) === name) { out.push(e); if (one) break; }
    for (let i = e.children.length - 1; i >= 0; i--) stack.push(e.children[i]);
  }
  return out;
}
function all(node: Document | Element, name: string): Element[] {
  return walk(node, name, false);
}
function first(node: Document | Element, name: string): Element | null {
  return walk(node, name, true)[0] ?? null;
}
function children(node: Element, name: string): Element[] {
  return [...node.children].filter(c => local(c) === name);
}
function num(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function truthy(value: string | null): boolean {
  return value === "1" || value === "true";
}
