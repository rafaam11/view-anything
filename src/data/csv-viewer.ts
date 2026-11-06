import "./data.css";
import { platform } from "../platform";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";
import { parseCsv, updateCsv, type CsvCell, type CsvRows } from "./csv";
import { decodeHint, decodeText, encodeRaw, type TextMeta } from "../text/codec";
import { registerTextSettings } from "../settings/document";
import { FileDocument } from "./document";
import { saveCopy } from "./save-copy";
import { documentBar } from "../ui/chrome";
import { menuButton, textButton } from "../ui/icons";
import { toast } from "../ui/toast";
import { COPY_SAVED, SAVED } from "../ui/strings";

const MAX_BYTES = 10 * 1024 * 1024;
/** A 10 MiB, 1,000,000-cell file parses in about 0.1-0.2 s; the page shows 100 rows × 10 columns at a time. */
const MAX_CELLS = 1_000_000;
const PAGE_ROWS = 100;
const PAGE_COLUMNS = 10;

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("CSV 파일이 10 MiB를 초과합니다.");
    const read = async () => new Uint8Array(await platform.readFileRaw(path));
    const doc = new FileDocument({ read, write: (bytes, expected) => platform.writeFileChecked(path, expected, bytes) }, await read());
    const name = path.split(/[\\/]/).pop() ?? path;
    const root = document.createElement("div"); root.className = "data-root va-viewer";
    const bar = document.createElement("header"); bar.className = "data-bar";
    const title = document.createElement("strong"); title.textContent = name;
    const edit = textButton("편집");
    const save = menuButton("저장"); save.hidden = true;
    const copy = menuButton("다른 이름으로 저장"); copy.hidden = true;
    const reload = menuButton("다시 읽기"); reload.hidden = true;
    const status = document.createElement("span"); status.setAttribute("role", "status");
    documentBar(bar, { toggle: edit, files: [save, copy, reload] });
    const body = document.createElement("div"); body.className = "data-table-wrap";
    const pages = document.createElement("nav"); pages.className = "data-pages"; pages.setAttribute("aria-label", "CSV 페이지");
    const previous = textButton("이전 페이지", "ghost");
    const next = textButton("다음 페이지", "ghost");
    const pageLabel = document.createElement("span");
    const previousColumns = textButton("이전 열", "ghost");
    const nextColumns = textButton("다음 열", "ghost");
    const columnLabel = document.createElement("span"); pages.append(previous, pageLabel, next, previousColumns, columnLabel, nextColumns);
    status.className = "va-status"; root.append(bar, status, pages, body); el.replaceChildren(root);
    let editing = false, approved = false, busy = false, invalid = false, cp949 = false, decodeFailed = false;
    let source = "", meta: TextMeta | null = null, changes = new Map<CsvCell, string>();
    let rows: CsvRows = [], page = 0, columnPage = 0, columnCount = 0, editRevision = 0;
    const dirty = () => doc.dirty || changes.size > 0 || invalid;
    const refresh = () => {
      title.textContent = (dirty() ? "● " : "") + name;
      void platform.setWindowTitle(title.textContent).catch(() => {});
    };
    const editBytes = async () => {
      if (!meta) throw new Error("읽을 수 없는 파일은 저장할 수 없습니다.");
      return encodeRaw(meta, updateCsv(source, ",", [...changes].map(([cell, value]) => ({ cell, value }))));
    };
    const showPage = () => {
      const table = document.createElement("table"); table.className = "data-table";
      for (const row of rows.slice(page * PAGE_ROWS, (page + 1) * PAGE_ROWS)) {
        const tr = document.createElement("tr");
        for (const cell of row.slice(columnPage * PAGE_COLUMNS, (columnPage + 1) * PAGE_COLUMNS)) {
          const td = document.createElement("td");
          if (editing) {
            const input = document.createElement("textarea"); input.value = changes.get(cell) ?? cell.value; input.rows = 1;
            input.setAttribute("aria-label", "CSV 셀");
            input.addEventListener("input", () => {
              if (input.value === cell.value) changes.delete(cell); else changes.set(cell, input.value);
              editRevision++; invalid = false; status.textContent = ""; refresh();
            });
            td.append(input);
          } else td.textContent = cell.value;
          tr.append(td);
        }
        table.append(tr);
      }
      body.replaceChildren(table); refresh();
      const count = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
      pageLabel.textContent = ` ${page + 1} / ${count} `;
      previous.disabled = page === 0; next.disabled = page + 1 >= count;
      const columns = Math.max(1, Math.ceil(columnCount / PAGE_COLUMNS));
      columnLabel.textContent = ` 열 ${columnPage + 1} / ${columns} `;
      previousColumns.disabled = columnPage === 0; nextColumns.disabled = columnPage + 1 >= columns;
      pages.hidden = count === 1 && columns === 1;
    };
    let mounted = false;
    /** Nothing editable can be shown: keep the window, drop to read mode with no stale cells, and say why. */
    const unreadable = (message: string) => {
      meta = null; source = ""; rows = []; columnCount = 0; decodeFailed = true;
      editing = false; edit.textContent = "편집"; edit.disabled = true; save.hidden = copy.hidden = true; reload.hidden = false;
      body.replaceChildren(); pages.hidden = true; status.textContent = message; refresh();
    };
    /** Decode with the chosen encoding and parse; the table only changes once both succeeded. */
    const render = async () => {
      changes = new Map(); invalid = false; page = columnPage = 0;
      let decoded: TextMeta;
      try { decoded = await decodeText(doc.bytes, cp949); }
      catch (e) { unreadable(decodeHint(e)); return; }
      let parsed: CsvRows;
      try { parsed = parseCsv(decoded.text, ",", MAX_CELLS); }
      catch (e) {
        if (!mounted) throw e; // the first render fails the mount, so the app offers "텍스트로 열기"
        unreadable(String(e)); return;
      }
      const note = cp949 ? "CP949로 읽음" : "";
      if (decodeFailed || !status.textContent || status.textContent === "CP949로 읽음") status.textContent = note;
      decodeFailed = false; edit.disabled = false;
      meta = decoded; source = decoded.text; rows = parsed;
      columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0); showPage();
    };
    previous.onclick = () => { if (page > 0) { page--; showPage(); } };
    next.onclick = () => { if ((page + 1) * PAGE_ROWS < rows.length) { page++; showPage(); } };
    previousColumns.onclick = () => { if (columnPage > 0) { columnPage--; showPage(); } };
    nextColumns.onclick = () => { if ((columnPage + 1) * PAGE_COLUMNS < columnCount) { columnPage++; showPage(); } };
    const report = (error: unknown) => { void platform.alert(String(error)).catch(() => {}); };
    const confirmLeave = async () => {
      if (approved || !dirty()) return true;
      return platform.confirmDiscard("저장하지 않은 CSV 변경을 버릴까요?");
    };
    edit.onclick = () => { void (async () => {
      if (busy) return;
      busy = true;
      try {
        if (editing && !await confirmLeave()) return;
        if (editing && dirty()) { doc.reset(await read()); }
        else if (!editing) await doc.reload();
        editing = !editing; edit.textContent = editing ? "읽기" : "편집"; save.hidden = copy.hidden = !editing; reload.hidden = true;
        await render();
      } finally { busy = false; }
    })().catch(report); };
    const doSave = async () => {
      if (!editing || busy || invalid) return;
      busy = true; save.disabled = true;
      try {
        const revision = editRevision;
        doc.edit(await editBytes());
        const result = await doc.save();
        if (result === "conflict") { reload.hidden = false; await platform.alert("파일이 외부에서 변경되었거나 삭제되었습니다. 편집 내용을 유지합니다. 다른 이름으로 저장하거나 다시 읽을 수 있습니다."); }
        else if (result === "saved" || result === "unchanged") {
          status.textContent = ""; toast(SAVED);
          if (editRevision === revision) await render();
          else doc.edit(await editBytes());
        }
        refresh();
      } catch (error) { reload.hidden = false; throw error; }
      finally { busy = false; save.disabled = false; }
    };
    save.onclick = () => { void doSave().catch(report); };
    copy.onclick = () => { void (async () => {
      if (!editing || busy || invalid) return; busy = true;
      try { if (await saveCopy(path, await editBytes())) toast(COPY_SAVED); }
      finally { busy = false; }
    })().catch(report); };
    reload.onclick = () => { void (async () => {
      if (busy) return; busy = true; // also offered in read mode after a file became unreadable
      try {
        if (dirty() && !await platform.confirmDiscard("편집 내용을 버리고 파일을 다시 읽을까요?")) return;
        reload.hidden = true; doc.reset(await read()); await render();
      } finally { busy = false; }
    })().catch(report); };
    window.addEventListener("keydown", e => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); if (!e.repeat) void doSave().catch(report); }
      else if (editing && (e.key === "F5" || e.key === "BrowserBack" || e.key === "BrowserForward" || e.key === "BrowserRefresh" || (e.ctrlKey && e.key.toLowerCase() === "r") || (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")))) {
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
    for (const event of ["mousedown", "mouseup"]) window.addEventListener(event, e => {
      const mouse = e as MouseEvent;
      if (editing && (mouse.button === 3 || mouse.button === 4)) mouse.preventDefault();
    }, true);
    window.addEventListener("focus", () => { if (!editing && !busy) void doc.reload().then(async changed => { if (changed) await render(); }).catch(report); });
    window.addEventListener("beforeunload", e => { if (!approved && dirty()) e.preventDefault(); });
    registerUpdateGuard(dirty, value => { approved = value; });
    registerTextSettings({
      encoding: () => cp949 ? "cp949" : "utf",
      changeEncoding: async (value) => {
        if (busy) return;
        if (editing && dirty() && !await confirmLeave()) return;
        busy = true;
        try { cp949 = value === "cp949"; doc.reset(await read()); await render(); } finally { busy = false; }
      },
    });
    await platform.onCloseRequested(confirmLeave);
    await render();
    mounted = true;
  },
};
export default viewer;
