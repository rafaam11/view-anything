import "../../data/data.css";
import "../office.css";
import { platform } from "../../platform";
import type { Viewer } from "../../registry";
import { tablePager } from "../../data/table-pages";
import { documentBar } from "../../ui/chrome";
import { textButton } from "../../ui/icons";
import { errorMessage } from "../../ui/strings";
import { checkOfficePackage } from "../zip-guard";
import { zoomControls } from "../zoom";
import { columnName, readWorkbook, type Border, type Cell, type CellStyle, type Sheet } from "./read";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_CELLS = 1_000_000;
const PAGE_ROWS = 200;
const PAGE_COLUMNS = 50;
const HEADER_WIDTH = 44, HEADER_HEIGHT = 20;

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("Excel 파일이 100 MiB를 초과합니다.");
    const bytes = new Uint8Array(await platform.readFileRaw(path));
    checkOfficePackage(bytes, "Excel");
    const book = await readWorkbook(bytes, MAX_CELLS).catch((e: unknown) => { throw new Error(`Excel 파일을 읽을 수 없습니다: ${errorMessage(e)}`); });
    const { sheets, styles } = book;
    const root = document.createElement("div"); root.className = "data-root office-root xlsx-root va-viewer";
    const bar = document.createElement("header"); bar.className = "data-bar";
    const status = document.createElement("span"); status.setAttribute("role", "status"); status.className = "va-status";
    const banner = document.createElement("div"); banner.className = "va-banner"; banner.dataset.kind = "warning"; banner.hidden = true;
    const scroll = document.createElement("div"); scroll.className = "xlsx-scroll"; scroll.tabIndex = 0; scroll.setAttribute("aria-label", "시트");
    const tabs = document.createElement("nav"); tabs.className = "xlsx-tabs"; tabs.setAttribute("aria-label", "시트 목록");
    const pager = tablePager("시트 페이지", { rows: PAGE_ROWS, columns: PAGE_COLUMNS }, () => draw());
    const zoom = zoomControls(scroll, scale => { if (table) table.style.zoom = String(scale); });
    documentBar(bar, { controls: zoom.controls, view: sheets.length > 1 ? [
      { label: "다음 시트", shortcut: "Ctrl+PgDn", run: () => select(current + 1) },
      { label: "이전 시트", shortcut: "Ctrl+PgUp", run: () => select(current - 1) },
    ] : [] });
    root.append(bar, banner, pager.element, scroll, tabs, status); el.replaceChildren(root);
    let current = -1, sheet: Sheet | null = null, table: HTMLTableElement | null = null, generation = 0;
    const tabButtons = sheets.map((entry, i) => {
      const b = textButton(entry.name, "ghost"); b.classList.add("xlsx-tab"); b.onclick = () => select(i);
      return b;
    });
    tabs.append(...tabButtons);
    tabs.hidden = sheets.length < 2;
    const note = book.hiddenSheets ? `읽기 전용 · 숨긴 시트 ${book.hiddenSheets}개` : "읽기 전용";
    const select = (index: number) => {
      if (index < 0 || index >= sheets.length || index === current) return;
      current = index;
      tabButtons.forEach((b, i) => b.setAttribute("aria-current", i === index ? "page" : "false"));
      tabButtons[index].scrollIntoView?.({ block: "nearest", inline: "nearest" });
      const mine = ++generation;
      status.textContent = "시트를 읽는 중…";
      void sheets[index].load().then(loaded => {
        if (mine !== generation) return;
        sheet = loaded; pager.row = pager.column = 0;
        banner.textContent = loaded.truncated ? `셀이 ${MAX_CELLS.toLocaleString()}개를 넘어 앞부분만 표시합니다.` : "";
        banner.hidden = !loaded.truncated;
        status.textContent = note; draw(); scroll.scrollTo?.(0, 0);
      }, e => {
        if (mine !== generation) return;
        sheet = null; scroll.replaceChildren(); pager.element.hidden = true;
        status.textContent = `시트를 표시할 수 없습니다: ${errorMessage(e)}`;
      });
    };
    const draw = () => {
      if (!sheet) return;
      pager.update(sheet.rowCount, sheet.columnCount);
      table = renderSheet(sheet, styles, pager.row * PAGE_ROWS, pager.column * PAGE_COLUMNS);
      table.style.zoom = String(zoom.scale());
      scroll.replaceChildren(table);
    };
    window.addEventListener("keydown", e => {
      if (document.querySelector("dialog[open]") || !e.ctrlKey) return;
      if (e.key === "PageDown") { e.preventDefault(); select(current + 1); }
      else if (e.key === "PageUp") { e.preventDefault(); select(current - 1); }
    });
    zoom.set(1);
    select(0);
  },
};
export default viewer;

/** One page of a sheet: rows [row0, row0+PAGE_ROWS), columns [column0, column0+PAGE_COLUMNS). */
export function renderSheet(sheet: Sheet, styles: CellStyle[], row0: number, column0: number): HTMLTableElement {
  const rowEnd = Math.min(sheet.rowCount, row0 + PAGE_ROWS), columnEnd = Math.min(sheet.columnCount, column0 + PAGE_COLUMNS);
  const rows: number[] = [], columns: number[] = [];
  for (let r = row0; r < rowEnd; r++) if (!sheet.hiddenRows.has(r)) rows.push(r);
  for (let c = column0; c < columnEnd; c++) if (!sheet.hiddenColumns.has(c)) columns.push(c);
  const width = (c: number) => sheet.columnWidths.get(c) ?? sheet.defaultColumnWidth;
  const height = (r: number) => sheet.rowHeights.get(r) ?? sheet.defaultRowHeight;
  const table = document.createElement("table"); table.className = "xlsx-grid";
  if (!sheet.gridLines) table.classList.add("xlsx-no-grid");
  const colgroup = document.createElement("colgroup");
  const headerCol = document.createElement("col"); headerCol.style.width = `${HEADER_WIDTH}px`; colgroup.append(headerCol);
  let tableWidth = HEADER_WIDTH;
  for (const c of columns) { const col = document.createElement("col"); col.style.width = `${width(c)}px`; tableWidth += width(c); colgroup.append(col); }
  table.style.width = `${tableWidth}px`;
  table.append(colgroup);
  // Frozen panes stay put only while their rows and columns are on the page.
  const frozenTop = new Map<number, number>(), frozenLeft = new Map<number, number>();
  if (row0 === 0) { let top = HEADER_HEIGHT; for (const r of rows) { if (r >= sheet.frozenRows) break; frozenTop.set(r, top); top += height(r); } }
  if (column0 === 0) { let left = HEADER_WIDTH; for (const c of columns) { if (c >= sheet.frozenColumns) break; frozenLeft.set(c, left); left += width(c); } }
  const head = document.createElement("thead"), headRow = document.createElement("tr");
  const corner = document.createElement("th"); corner.className = "xlsx-corner"; headRow.append(corner);
  for (const c of columns) {
    const th = document.createElement("th"); th.textContent = columnName(c); th.scope = "col";
    const left = frozenLeft.get(c); if (left !== undefined) { th.style.left = `${left}px`; th.classList.add("xlsx-frozen-col"); }
    headRow.append(th);
  }
  head.append(headRow); table.append(head);
  // Merged ranges clipped to this page: the first visible cell spans the rest, which are skipped.
  const covered = new Set<string>(), spans = new Map<string, { rows: number; columns: number; origin: boolean }>();
  for (const m of sheet.merges) {
    if (m.r2 < row0 || m.r1 >= rowEnd || m.c2 < column0 || m.c1 >= columnEnd) continue;
    const mr = rows.filter(r => r >= m.r1 && r <= m.r2), mc = columns.filter(c => c >= m.c1 && c <= m.c2);
    if (!mr.length || !mc.length) continue;
    spans.set(`${mr[0]},${mc[0]}`, { rows: mr.length, columns: mc.length, origin: mr[0] === m.r1 && mc[0] === m.c1 });
    for (const r of mr) for (const c of mc) if (r !== mr[0] || c !== mc[0]) covered.add(`${r},${c}`);
  }
  const body = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr"); tr.style.height = `${height(r)}px`;
    const th = document.createElement("th"); th.textContent = String(r + 1); th.scope = "row"; tr.append(th);
    const top = frozenTop.get(r);
    if (top !== undefined) { tr.classList.add("xlsx-frozen-row"); th.style.top = `${top}px`; }
    const cells = sheet.rows.get(r);
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i], key = `${r},${c}`;
      if (covered.has(key)) continue;
      const td = document.createElement("td");
      const span = spans.get(key);
      if (span) { if (span.rows > 1) td.rowSpan = span.rows; if (span.columns > 1) td.colSpan = span.columns; }
      const cell = span && !span.origin ? undefined : cells?.get(c);
      if (cell) {
        styleCell(td, styles[cell.style] ?? {}, cell);
        td.textContent = cell.text;
        // Text runs over empty neighbours on the right, as in Excel; numbers and wrapped text stay inside.
        const neighbour = columns[i + 1];
        const spills = !cell.number && !styles[cell.style]?.wrap && !span && (neighbour === undefined || !cells?.get(neighbour)?.text) && (styles[cell.style]?.horizontal ?? "left") === "left";
        if (spills && cell.text) td.classList.add("xlsx-spill");
      }
      if (top !== undefined) td.style.top = `${top}px`;
      const left = frozenLeft.get(c);
      if (left !== undefined) { td.style.left = `${left}px`; td.classList.add("xlsx-frozen-col"); }
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body);
  return table;
}

const BORDER: Record<string, string> = {
  thin: "1px solid", medium: "2px solid", thick: "3px solid", dashed: "1px dashed", dotted: "1px dotted",
  double: "3px double", hair: "1px dotted", mediumDashed: "2px dashed", dashDot: "1px dashed", mediumDashDot: "2px dashed",
  dashDotDot: "1px dotted", mediumDashDotDot: "2px dotted", slantDashDot: "2px dashed",
};

function border(b: Border | undefined): string {
  return b ? `${BORDER[b.style] ?? "1px solid"} ${b.color ?? "#000000"}` : "";
}

function styleCell(td: HTMLTableCellElement, s: CellStyle, cell: Cell) {
  const st = td.style;
  if (s.bold) st.fontWeight = "bold";
  if (s.italic) st.fontStyle = "italic";
  const lines = [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (lines) st.textDecoration = lines;
  if (s.color) st.color = s.color;
  if (s.size) st.fontSize = `${s.size}pt`;
  if (s.font) st.fontFamily = `"${s.font.replace(/["\\]/g, "")}", var(--font-ui)`;
  if (s.fill) st.backgroundColor = s.fill;
  const h = s.horizontal ?? (cell.number ? "right" : "left");
  st.textAlign = h === "centerContinuous" ? "center" : h === "fill" ? "left" : h === "distributed" ? "justify" : h;
  st.verticalAlign = s.vertical === "center" ? "middle" : s.vertical === "top" ? "top" : s.vertical === "justify" || s.vertical === "distributed" ? "middle" : "bottom";
  if (s.wrap) td.classList.add("xlsx-wrap");
  if (s.indent) st.paddingInlineStart = `${s.indent * 9 + 2}px`;
  if (s.top) st.borderTop = border(s.top);
  if (s.right) st.borderRight = border(s.right);
  if (s.bottom) st.borderBottom = border(s.bottom);
  if (s.left) st.borderLeft = border(s.left);
}
