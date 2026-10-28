import "./data.css";
import { platform } from "../platform";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";
import { parseCsv, updateCsv, type CsvCell } from "./csv";
import { decodeDataText, encodeDataText } from "./text";
import { FileDocument } from "./document";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CELLS = 100_000;

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("CSV 파일이 10 MiB를 초과합니다.");
    const read = async () => new Uint8Array(await platform.readFileRaw(path));
    const doc = new FileDocument({ read, write: (bytes, expected) => platform.writeFileChecked(path, expected, bytes) }, await read());
    const name = path.split(/[\\/]/).pop() ?? path;
    const root = document.createElement("div"); root.className = "data-root";
    const bar = document.createElement("header"); bar.className = "data-bar";
    const title = document.createElement("strong"); title.textContent = name;
    const edit = document.createElement("button"); edit.textContent = "편집";
    const save = document.createElement("button"); save.textContent = "저장"; save.hidden = true;
    const status = document.createElement("span"); status.setAttribute("role", "status");
    bar.append(title, edit, save, status);
    const body = document.createElement("div"); body.className = "data-table-wrap";
    root.append(bar, body); el.replaceChildren(root);
    let editing = false, approved = false, busy = false, invalid = false;
    let source = "", meta = decodeDataText(doc.bytes), changes = new Map<CsvCell, string>();
    const dirty = () => doc.dirty || invalid;
    const refresh = () => {
      title.textContent = (dirty() ? "● " : "") + name;
      void platform.setWindowTitle(title.textContent).catch(() => {});
    };
    const render = () => {
      meta = decodeDataText(doc.bytes); source = meta.text; changes = new Map(); invalid = false;
      const rows = parseCsv(source);
      if (rows.reduce((n, row) => n + row.length, 0) > MAX_CELLS) throw new Error("CSV 셀이 100,000개를 초과합니다.");
      const table = document.createElement("table"); table.className = "data-table";
      for (const row of rows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          if (editing) {
            const input = document.createElement("textarea"); input.value = cell.value; input.rows = 1;
            input.setAttribute("aria-label", "CSV 셀");
            input.addEventListener("input", () => {
              if (input.value === cell.value) changes.delete(cell); else changes.set(cell, input.value);
              try {
                const text = updateCsv(source, ",", [...changes].map(([cell, value]) => ({ cell, value })));
                doc.edit(encodeDataText({ ...meta, text })); invalid = false; status.textContent = ""; refresh();
              } catch (error) { invalid = true; status.textContent = String(error); refresh(); }
            });
            td.append(input);
          } else td.textContent = cell.value;
          tr.append(td);
        }
        table.append(tr);
      }
      body.replaceChildren(table); refresh();
    };
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
        editing = !editing; edit.textContent = editing ? "읽기" : "편집"; save.hidden = !editing;
        render();
      } finally { busy = false; }
    })().catch(report); };
    const doSave = async () => {
      if (!editing || busy || invalid) return;
      busy = true; save.disabled = true;
      try {
        const result = await doc.save();
        if (result === "conflict") await platform.alert("파일이 외부에서 변경되었거나 삭제되었습니다. 편집 내용을 유지합니다.");
        else if (result === "saved") { status.textContent = "저장됨"; if (!dirty()) render(); }
        refresh();
      } finally { busy = false; save.disabled = false; }
    };
    save.onclick = () => { void doSave().catch(report); };
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
    window.addEventListener("focus", () => { if (!editing && !busy) void doc.reload().then(changed => { if (changed) render(); }).catch(report); });
    window.addEventListener("beforeunload", e => { if (!approved && dirty()) e.preventDefault(); });
    registerUpdateGuard(dirty, value => { approved = value; });
    await platform.onCloseRequested(confirmLeave);
    render();
  },
};
export default viewer;
