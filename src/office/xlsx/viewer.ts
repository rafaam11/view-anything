import "../../data/data.css";
import "../office.css";
import { platform } from "../../platform";
import type { Viewer } from "../../registry";
import { tablePager } from "../../data/table-pages";
import { documentBar } from "../../ui/chrome";
import { textButton } from "../../ui/icons";
import { errorMessage } from "../../ui/strings";
import { toast } from "../../ui/toast";
import { checkOfficePackage } from "../zip-guard";
import { officeStatusBar } from "../zoom";
import { columnName, readWorkbook, type Border, type Cell, type CellStyle, type Sheet } from "./read";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_CELLS = 1_000_000;
/** Copying more than this many cells at once is refused rather than freezing the window. */
const MAX_COPY = 1_000_000;
const PAGE_ROWS = 200;
const PAGE_COLUMNS = 50;
const HEADER_WIDTH = 44, HEADER_HEIGHT = 20;

type Pos = { r: number; c: number };
type Range = { r1: number; c1: number; r2: number; c2: number };

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("Excel 파일이 100 MiB를 초과합니다.");
    const bytes = new Uint8Array(await platform.readFileRaw(path));
    checkOfficePackage(bytes, "Excel");
    const book = await readWorkbook(bytes, MAX_CELLS).catch((e: unknown) => { throw new Error(`Excel 파일을 읽을 수 없습니다: ${errorMessage(e)}`); });
    const { sheets, styles } = book;
    const root = document.createElement("div"); root.className = "office-root xlsx-root va-viewer"; root.dataset.office = "excel";
    const bar = document.createElement("header");
    const banner = document.createElement("div"); banner.className = "va-banner"; banner.dataset.kind = "warning"; banner.hidden = true;
    // Formula bar: the name box, then the active cell's formula or value. Both read-only.
    const formulaBar = document.createElement("div"); formulaBar.className = "xlsx-formula-bar";
    const nameBox = document.createElement("output"); nameBox.className = "xlsx-name-box"; nameBox.setAttribute("aria-label", "이름 상자");
    const fx = document.createElement("span"); fx.className = "xlsx-fx"; fx.textContent = "fx"; fx.setAttribute("aria-hidden", "true");
    const formula = document.createElement("output"); formula.className = "xlsx-formula"; formula.setAttribute("aria-label", "수식 입력줄");
    formulaBar.append(nameBox, fx, formula);
    const scroll = document.createElement("div"); scroll.className = "xlsx-scroll"; scroll.tabIndex = 0; scroll.setAttribute("aria-label", "시트");
    const tabs = document.createElement("nav"); tabs.className = "xlsx-tabs"; tabs.setAttribute("aria-label", "시트 목록");
    const tabList = document.createElement("div"); tabList.className = "xlsx-tab-list";
    const pager = tablePager("시트 페이지", { rows: PAGE_ROWS, columns: PAGE_COLUMNS }, () => draw());
    tabs.append(tabList, pager.element);
    const status = officeStatusBar(scroll, scale => { if (table) table.style.zoom = String(scale); });
    documentBar(bar, {
      actions: [{ label: "복사", shortcut: "Ctrl+C", run: () => copy() }, { label: "모두 선택", shortcut: "Ctrl+A", run: () => selectAll() }],
      view: sheets.length > 1 ? [
        { label: "다음 시트", shortcut: "Ctrl+PgDn", run: () => select(current + 1) },
        { label: "이전 시트", shortcut: "Ctrl+PgUp", run: () => select(current - 1) },
      ] : [],
    });
    root.append(bar, banner, formulaBar, scroll, tabs, status.element); el.replaceChildren(root);
    let current = -1, sheet: Sheet | null = null, table: HTMLTableElement | null = null, generation = 0;
    let anchor: Pos = { r: 0, c: 0 }, active: Pos = { r: 0, c: 0 }, dragging = false;
    const tabButtons = sheets.map((entry, i) => {
      const b = textButton(entry.name, "ghost"); b.classList.add("xlsx-tab"); b.onclick = () => select(i);
      return b;
    });
    tabList.append(...tabButtons);
    const readOnly = book.hiddenSheets ? `읽기 전용 · 숨긴 시트 ${book.hiddenSheets}개` : "읽기 전용";

    const range = (): Range => ({ r1: Math.min(anchor.r, active.r), c1: Math.min(anchor.c, active.c), r2: Math.max(anchor.r, active.r), c2: Math.max(anchor.c, active.c) });
    const mergeAt = (p: Pos) => sheet?.merges.find(m => p.r >= m.r1 && p.r <= m.r2 && p.c >= m.c1 && p.c <= m.c2);
    const cellAt = (p: Pos): Cell | undefined => sheet?.rows.get(p.r)?.get(p.c);
    /** Shows the selection: cell classes, header highlights, the name box, formula bar and status bar. */
    const paint = () => {
      if (!sheet || !table) return;
      const sel = range();
      for (const td of table.querySelectorAll<HTMLTableCellElement>("td[data-r]")) {
        const r = Number(td.dataset.r), c = Number(td.dataset.c);
        const rows = td.rowSpan - 1, cols = td.colSpan - 1;
        td.classList.toggle("xlsx-sel", r <= sel.r2 && r + rows >= sel.r1 && c <= sel.c2 && c + cols >= sel.c1);
        td.classList.toggle("xlsx-active", r === anchor.r && c === anchor.c);
      }
      for (const th of table.querySelectorAll<HTMLElement>("thead th[data-c]")) { const c = Number(th.dataset.c); th.classList.toggle("xlsx-sel-head", c >= sel.c1 && c <= sel.c2); }
      for (const th of table.querySelectorAll<HTMLElement>("tbody th[data-r]")) { const r = Number(th.dataset.r); th.classList.toggle("xlsx-sel-head", r >= sel.r1 && r <= sel.r2); }
      const multiple = sel.r1 !== sel.r2 || sel.c1 !== sel.c2;
      nameBox.textContent = dragging && multiple ? `${sel.r2 - sel.r1 + 1}R x ${sel.c2 - sel.c1 + 1}C` : `${columnName(anchor.c)}${anchor.r + 1}`;
      // As in Excel the active cell is where the selection started; `active` is its moving corner.
      const cell = cellAt(anchor);
      formula.textContent = cell?.formula ?? cell?.text ?? "";
      status.info([readOnly, multiple ? statistics(sheet, sel) : ""]);
    };
    /** Moves the active cell (and with `extend` keeps the anchor), turning the page when it leaves it. */
    const go = (to: Pos, extend = false) => {
      if (!sheet) return;
      to = { r: Math.max(0, Math.min(1_048_575, to.r)), c: Math.max(0, Math.min(16383, to.c)) };
      const merge = extend ? undefined : mergeAt(to);
      active = merge ? { r: merge.r1, c: merge.c1 } : to;
      if (!extend) anchor = { ...active };
      const page = Math.floor(active.r / PAGE_ROWS), block = Math.floor(active.c / PAGE_COLUMNS);
      if (page !== pager.row || block !== pager.column) {
        // The pager only has pages for the used range; beyond it the selection stays off-page.
        const rowPages = Math.max(1, Math.ceil(sheet.rowCount / PAGE_ROWS)), columnPages = Math.max(1, Math.ceil(sheet.columnCount / PAGE_COLUMNS));
        if (page < rowPages && block < columnPages) { pager.row = page; pager.column = block; draw(); }
      }
      paint();
      table?.querySelector<HTMLElement>(`td[data-r="${active.r}"][data-c="${active.c}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    const select = (index: number) => {
      if (index < 0 || index >= sheets.length || index === current) return;
      current = index;
      tabButtons.forEach((b, i) => b.setAttribute("aria-current", i === index ? "page" : "false"));
      tabButtons[index].scrollIntoView?.({ block: "nearest", inline: "nearest" });
      const mine = ++generation;
      status.info(["시트를 읽는 중…"]);
      void sheets[index].load().then(loaded => {
        if (mine !== generation) return;
        sheet = loaded; pager.row = pager.column = 0; anchor = { r: 0, c: 0 }; active = { r: 0, c: 0 };
        banner.textContent = loaded.truncated ? `셀이 ${MAX_CELLS.toLocaleString()}개를 넘어 앞부분만 표시합니다.` : "";
        banner.hidden = !loaded.truncated;
        draw(); scroll.scrollTo?.(0, 0);
        // Like Excel, the sheet takes the keyboard as soon as it shows, unless something else has it.
        if (document.activeElement === document.body) scroll.focus({ preventScroll: true });
      }, e => {
        if (mine !== generation) return;
        sheet = null; table = null; scroll.replaceChildren(); pager.element.hidden = true;
        nameBox.textContent = ""; formula.textContent = "";
        status.info([`시트를 표시할 수 없습니다: ${errorMessage(e)}`]);
      });
    };
    const draw = () => {
      if (!sheet) return;
      pager.update(sheet.rowCount, sheet.columnCount);
      table = renderSheet(sheet, styles, pager.row * PAGE_ROWS, pager.column * PAGE_COLUMNS);
      table.style.zoom = String(status.zoom.scale());
      scroll.replaceChildren(table);
      paint();
    };
    const selectAll = () => {
      if (!sheet) return;
      anchor = { r: 0, c: 0 }; active = { r: Math.max(0, sheet.rowCount - 1), c: Math.max(0, sheet.columnCount - 1) };
      paint();
    };
    const copy = () => {
      if (!sheet) return;
      const sel = range();
      if ((sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1) > MAX_COPY) { void platform.alert(`${MAX_COPY.toLocaleString()}개가 넘는 셀은 한 번에 복사할 수 없습니다.`).catch(() => {}); return; }
      const lines: string[] = [];
      for (let r = sel.r1; r <= sel.r2; r++) {
        if (sheet.hiddenRows.has(r)) continue;
        const row = sheet.rows.get(r), out: string[] = [];
        for (let c = sel.c1; c <= sel.c2; c++) if (!sheet.hiddenColumns.has(c)) out.push(tsvField(row?.get(c)?.text ?? ""));
        lines.push(out.join("\t"));
      }
      void platform.copyText(`${lines.join("\r\n")}\r\n`).then(() => toast("셀을 복사했습니다"), e => { void platform.alert(errorMessage(e)).catch(() => {}); });
    };
    const posOf = (target: EventTarget | null): Pos | null => {
      const td = (target as Element | null)?.closest?.("td[data-r]") as HTMLElement | null;
      return td ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null;
    };
    scroll.addEventListener("pointerdown", e => {
      if (e.button !== 0 || !sheet) return;
      const head = (e.target as Element | null)?.closest?.("th") as HTMLElement | null;
      if (head) {
        e.preventDefault(); scroll.focus({ preventScroll: true });
        const last = { r: Math.max(0, sheet.rowCount - 1), c: Math.max(0, sheet.columnCount - 1) };
        if (head.dataset.c !== undefined) { const c = Number(head.dataset.c); anchor = { r: 0, c: e.shiftKey ? anchor.c : c }; active = { r: last.r, c }; }
        else if (head.dataset.r !== undefined) { const r = Number(head.dataset.r); anchor = { r: e.shiftKey ? anchor.r : r, c: 0 }; active = { r, c: last.c }; }
        else { anchor = { r: 0, c: 0 }; active = last; }
        paint(); return;
      }
      const p = posOf(e.target);
      if (!p) return;
      e.preventDefault(); scroll.focus({ preventScroll: true });
      dragging = true; scroll.setPointerCapture?.(e.pointerId);
      go(p, e.shiftKey);
    });
    scroll.addEventListener("pointermove", e => {
      if (!dragging) return;
      const p = posOf(document.elementFromPoint?.(e.clientX, e.clientY) ?? e.target);
      if (p && (p.r !== active.r || p.c !== active.c)) { active = p; paint(); }
    });
    const endDrag = () => { if (dragging) { dragging = false; paint(); } };
    scroll.addEventListener("pointerup", endDrag);
    scroll.addEventListener("pointercancel", endDrag);
    window.addEventListener("keydown", e => {
      if (document.querySelector("dialog[open]") || !sheet) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.ctrlKey && key === "PageDown") { e.preventDefault(); select(current + 1); return; }
      if (e.ctrlKey && key === "PageUp") { e.preventDefault(); select(current - 1); return; }
      // Cell keys belong to the sheet; on the toolbar, menus and tabs Tab and the arrows keep their own job.
      if (e.altKey || (e.target !== scroll && e.target !== document.body)) return;
      if (e.ctrlKey && !e.shiftKey && key === "c") { e.preventDefault(); copy(); return; }
      if (e.ctrlKey && !e.shiftKey && key === "a") { e.preventDefault(); selectAll(); return; }
      const step = moves[e.key];
      if (step) {
        e.preventDefault();
        const back = e.shiftKey && (e.key === "Tab" || e.key === "Enter");
        const extend = e.shiftKey && !back;
        const [dr, dc] = back ? [-step[0], -step[1]] : step;
        const count = e.key === "PageDown" || e.key === "PageUp" ? visibleRows() : 1;
        // Extending moves the far corner; a plain move starts from the active cell.
        const from = extend ? active : anchor;
        go(e.ctrlKey ? jump(sheet, from, dr, dc) : stepOver(sheet, from, dr, dc, count), extend);
      } else if (e.key === "Home") {
        e.preventDefault(); go(e.ctrlKey ? { r: 0, c: 0 } : { r: active.r, c: 0 }, e.shiftKey);
      } else if (e.key === "End" && e.ctrlKey) {
        e.preventDefault(); go({ r: Math.max(0, sheet.rowCount - 1), c: Math.max(0, sheet.columnCount - 1) }, e.shiftKey);
      }
    });
    const visibleRows = () => Math.max(1, Math.floor(scroll.clientHeight / ((sheet?.defaultRowHeight ?? 20) * status.zoom.scale())) - 1);
    status.zoom.set(1);
    select(0);
  },
};
export default viewer;

const moves: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
  Enter: [1, 0], Tab: [0, 1], PageDown: [1, 0], PageUp: [-1, 0],
};

/** `count` steps in a direction, skipping hidden rows and columns. */
export function stepOver(sheet: Sheet, from: Pos, dr: number, dc: number, count: number): Pos {
  let { r, c } = from;
  for (let i = 0; i < count; i++) {
    let nr = r + dr, nc = c + dc;
    while ((dr && sheet.hiddenRows.has(nr)) || (dc && sheet.hiddenColumns.has(nc))) { nr += dr; nc += dc; }
    if (nr < 0 || nc < 0 || nr >= 1_048_576 || nc >= 16384) break;
    r = nr; c = nc;
  }
  return { r, c };
}

/** Ctrl+arrow as in Excel: to the edge of the current block of filled cells, or to the next filled cell. */
export function jump(sheet: Sheet, from: Pos, dr: number, dc: number): Pos {
  const filled = (p: Pos) => !!sheet.rows.get(p.r)?.get(p.c)?.text;
  const limit = dr ? Math.max(sheet.rowCount, from.r + 1) : Math.max(sheet.columnCount, from.c + 1);
  const inside = (p: Pos) => p.r >= 0 && p.c >= 0 && (dr ? p.r < limit : p.c < limit);
  const next = (q: Pos) => ({ r: q.r + dr, c: q.c + dc });
  let p = from;
  if (filled(p) && inside(next(p)) && filled(next(p))) {
    while (inside(next(p)) && filled(next(p))) p = next(p);
    return p;
  }
  p = next(p);
  while (inside(p) && !filled(p)) p = next(p);
  if (inside(p)) return p;
  const end = dr > 0 || dc > 0 ? limit - 1 : 0;
  return { r: dr ? end : from.r, c: dc ? end : from.c };
}

/** Excel's status-bar summary of a selection: average, count of filled cells and sum. */
export function statistics(sheet: Sheet, sel: Range): string {
  let count = 0, numbers = 0, sum = 0;
  for (const [r, row] of sheet.rows) {
    if (r < sel.r1 || r > sel.r2 || sheet.hiddenRows.has(r)) continue;
    for (const [c, cell] of row) {
      if (c < sel.c1 || c > sel.c2 || sheet.hiddenColumns.has(c) || !cell.text) continue;
      count++;
      if (cell.value !== undefined && Number.isFinite(cell.value)) { numbers++; sum += cell.value; }
    }
  }
  if (!count) return "";
  const format = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 10 });
  return numbers ? `평균: ${format(sum / numbers)}   개수: ${count}   합계: ${format(sum)}` : `개수: ${count}`;
}

function tsvField(text: string): string {
  return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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
  const corner = document.createElement("th"); corner.className = "xlsx-corner"; corner.setAttribute("aria-label", "모두 선택"); headRow.append(corner);
  for (const c of columns) {
    const th = document.createElement("th"); th.textContent = columnName(c); th.scope = "col"; th.dataset.c = String(c);
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
    const th = document.createElement("th"); th.textContent = String(r + 1); th.scope = "row"; th.dataset.r = String(r); tr.append(th);
    const top = frozenTop.get(r);
    if (top !== undefined) { tr.classList.add("xlsx-frozen-row"); th.style.top = `${top}px`; }
    const cells = sheet.rows.get(r);
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i], key = `${r},${c}`;
      if (covered.has(key)) continue;
      const td = document.createElement("td"); td.dataset.r = String(r); td.dataset.c = String(c);
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
