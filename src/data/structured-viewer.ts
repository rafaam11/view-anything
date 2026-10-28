import "./data.css";
import { parse as parseYaml } from "yaml";
import { platform } from "../platform";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";
import { decodeDataText, encodeDataText } from "./text";
import { FileDocument } from "./document";
import { restoreLineEndings } from "./line-endings";
import { saveCopy } from "./save-copy";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NODES = 20_000;

function parse(text: string, yaml: boolean): unknown {
  return yaml ? parseYaml(text, { maxAliasCount: 100 }) : JSON.parse(text);
}

/** Render file-derived values as text only, with a bounded traversal. */
function tree(value: unknown): HTMLElement {
  const root = document.createElement("div"); root.className = "data-tree";
  let count = 0;
  const add = (host: HTMLElement, label: string, item: unknown, depth: number) => {
    if (++count > MAX_NODES || depth > 100) {
      host.append(document.createTextNode("표시 한도에 도달했습니다.")); return;
    }
    if (item !== null && typeof item === "object") {
      const details = document.createElement("details"); details.open = depth < 1;
      const summary = document.createElement("summary");
      const entries = Object.entries(item);
      summary.textContent = `${label}: ${Array.isArray(item) ? "배열" : "객체"} (${entries.length})`;
      details.append(summary); host.append(details);
      for (const [key, child] of entries) {
        if (count >= MAX_NODES) { details.append(document.createTextNode("표시 한도에 도달했습니다.")); break; }
        add(details, key, child, depth + 1);
      }
    } else {
      const line = document.createElement("div");
      line.textContent = `${label}: ${typeof item === "string" ? JSON.stringify(item) : String(item)}`;
      host.append(line);
    }
  };
  add(root, "루트", value, 0); return root;
}

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("파일이 10 MiB를 초과합니다.");
    const read = async () => new Uint8Array(await platform.readFileRaw(path));
    const doc = new FileDocument({ read, write: (bytes, expected) => platform.writeFileChecked(path, expected, bytes) }, await read());
    const yaml = /\.ya?ml$/i.test(path), name = path.split(/[\\/]/).pop() ?? path;
    let meta = decodeDataText(doc.bytes), editing = false, invalid = false, approved = false, busy = false;
    const root = document.createElement("div"); root.className = "data-root";
    const bar = document.createElement("header"); bar.className = "data-bar";
    const title = document.createElement("strong"); title.textContent = name;
    const toggle = document.createElement("button"); toggle.textContent = "편집";
    const save = document.createElement("button"); save.textContent = "저장"; save.hidden = true;
    const copy = document.createElement("button"); copy.textContent = "다른 이름으로 저장"; copy.hidden = true;
    const reload = document.createElement("button"); reload.textContent = "다시 읽기"; reload.hidden = true;
    const status = document.createElement("span"); status.setAttribute("role", "status");
    bar.append(title, toggle, save, copy, reload, status);
    const body = document.createElement("div");
    const editor = document.createElement("textarea"); editor.className = "data-source"; editor.hidden = true; editor.spellcheck = false;
    editor.setAttribute("aria-label", "원문 편집");
    root.append(bar, body, editor); el.replaceChildren(root);
    const dirty = () => doc.dirty || invalid;
    const refresh = () => { title.textContent = (dirty() ? "● " : "") + name; void platform.setWindowTitle(title.textContent).catch(() => {}); };
    const render = () => {
      meta = decodeDataText(doc.bytes); editor.value = meta.text; invalid = false;
      try { body.replaceChildren(tree(parse(meta.text, yaml))); status.textContent = ""; }
      catch (error) { body.replaceChildren(); status.textContent = "구문 오류: " + String(error); }
      refresh();
    };
    const report = (error: unknown) => { void platform.alert(String(error)).catch(() => {}); };
    const confirmLeave = async () => approved || !dirty() || await platform.confirmDiscard("저장하지 않은 변경을 버릴까요?");
    editor.addEventListener("input", () => {
      try { doc.edit(encodeDataText({ ...meta, text: restoreLineEndings(meta.text, editor.value) })); invalid = false; status.textContent = ""; }
      catch (error) { invalid = true; status.textContent = String(error); }
      refresh();
    });
    toggle.onclick = () => { void (async () => {
      if (busy) return; busy = true;
      try {
        if (editing && !await confirmLeave()) return;
        if (editing && dirty()) doc.reset(await read());
        else if (!editing) await doc.reload();
        editing = !editing; toggle.textContent = editing ? "읽기" : "편집"; save.hidden = copy.hidden = !editing; reload.hidden = true;
        render(); body.hidden = editing; editor.hidden = !editing;
      } finally { busy = false; }
    })().catch(report); };
    const doSave = async () => {
      if (!editing || invalid || busy) return;
      try { parse(editor.value, yaml); } catch (error) { status.textContent = "구문 오류: " + String(error); return; }
      busy = true; save.disabled = true;
      try {
        const result = await doc.save();
        if (result === "conflict") { reload.hidden = false; await platform.alert("파일이 외부에서 변경되었거나 삭제되었습니다. 편집 내용을 유지합니다. 다른 이름으로 저장하거나 다시 읽을 수 있습니다."); }
        else if (result === "saved") status.textContent = "저장됨";
        refresh();
      } catch (error) { reload.hidden = false; throw error; }
      finally { busy = false; save.disabled = false; }
    };
    save.onclick = () => { void doSave().catch(report); };
    copy.onclick = () => { void (async () => {
      if (!editing || busy || invalid) return; busy = true;
      try { if (await saveCopy(path, doc.bytes)) status.textContent = "복사본 저장됨 · 원본 편집 내용 유지"; }
      finally { busy = false; }
    })().catch(report); };
    reload.onclick = () => { void (async () => {
      if (!editing || busy) return; busy = true;
      try {
        if (dirty() && !await platform.confirmDiscard("편집 내용을 버리고 파일을 다시 읽을까요?")) return;
        doc.reset(await read()); render(); reload.hidden = true;
      } finally { busy = false; }
    })().catch(report); };
    window.addEventListener("keydown", e => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); if (!e.repeat) void doSave().catch(report); }
      else if (editing && (e.key === "F5" || e.key === "BrowserBack" || e.key === "BrowserForward" || e.key === "BrowserRefresh" || (e.ctrlKey && e.key.toLowerCase() === "r") || (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")))) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    for (const event of ["mousedown", "mouseup"]) window.addEventListener(event, e => { if (editing && ((e as MouseEvent).button === 3 || (e as MouseEvent).button === 4)) e.preventDefault(); }, true);
    window.addEventListener("focus", () => { if (!editing && !busy) void doc.reload().then(changed => { if (changed) render(); }).catch(report); });
    window.addEventListener("beforeunload", e => { if (!approved && dirty()) e.preventDefault(); });
    registerUpdateGuard(dirty, value => { approved = value; });
    await platform.onCloseRequested(confirmLeave); render();
  },
};
export default viewer;
