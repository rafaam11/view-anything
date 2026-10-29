import "./viewer.css";
import { platform } from "../platform";
import { FileDocument } from "../data/document";
import { saveCopy } from "../data/save-copy";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";
import { decodeText, encodeText, normalize, lineEndings, type TextMeta } from "./codec";
import { Menubar } from "../three/core/menubar";
import { registerTextSettings } from "../settings/document";
import "../ui/chrome.css";

const MAX_BYTES = 10 * 1024 * 1024;
const viewer: Viewer = {
  async mount(el, path) {
    const read = async () => {
      if (await platform.fileSize(path) > MAX_BYTES) throw new Error("파일이 10 MiB를 초과합니다.");
      const bytes = new Uint8Array(await platform.readFileRaw(path));
      if (bytes.length > MAX_BYTES) throw new Error("파일이 10 MiB를 초과합니다.");
      return bytes;
    };
    const doc = new FileDocument({ read, write: (bytes, expected) => platform.writeFileChecked(path, expected, bytes) }, await read());
    let meta: TextMeta | null = null, editing = false, busy = false, approved = false, cp949 = false;
    const name = path.split(/[\\/]/).pop() ?? path;
    const root = document.createElement("section"); root.className = "text-root va-viewer";
    const bar = document.createElement("header"); bar.className = "text-bar va-viewer-toolbar";
    const button = (label: string, run: () => Promise<void>) => {
      const b = document.createElement("button"); b.textContent = label;
      b.onclick = () => { void run().catch(report); }; bar.append(b); return b;
    };
    const status = document.createElement("p"); status.setAttribute("role", "status");
    const report = (e: unknown) => { status.textContent = String(e); };
    const editor = document.createElement("textarea"); editor.className = "text-source";
    editor.spellcheck = false; editor.wrap = "off"; editor.readOnly = true; editor.setAttribute("aria-label", "텍스트 내용");
    const dirty = () => doc.dirty || (meta !== null && editor.value !== normalize(meta.text));
    const refresh = () => {
      void platform.setWindowTitle((dirty() ? "● " : "") + name).catch(() => {});
      edit.disabled = busy || !meta || lineEndings(meta.text).mixed;
      editor.readOnly = !editing || busy;
    };
    const render = async () => {
      meta = null; editor.value = "";
      try {
        meta = await decodeText(doc.bytes, cp949); editor.value = normalize(meta.text);
        const { mixed } = lineEndings(meta.text);
        if (mixed) { editing = false; edit.textContent = "편집"; }
        status.textContent = mixed ? "혼합 줄바꿈 · 읽기 전용" : "";
      } catch (e) { editing = false; edit.textContent = "편집"; report(`${String(e)} 설정의 문자 인코딩에서 CP949를 선택할 수 있습니다.`); }
      refresh();
    };
    const exclusive = async (run: () => Promise<void>) => {
      if (busy || approved) return; busy = true; refresh();
      try { await run(); } finally { busy = false; refresh(); }
    };
    const discard = async () => !dirty() || await platform.confirmDiscard("저장하지 않은 변경을 버릴까요?");
    const edit = button("편집", async () => exclusive(async () => {
      if (!meta || lineEndings(meta.text).mixed || !await discard()) return;
      doc.reset(await read()); editing = !editing; edit.textContent = editing ? "읽기" : "편집";
      await render();
    }));
    const doCopy = async () => exclusive(async () => {
      if (!editing || !meta) return;
      const bytes = dirty() ? await encodeText(meta, editor.value) : doc.bytes;
      if (await saveCopy(path, bytes)) status.textContent = "복사본 저장됨 · 원본 편집 내용 유지";
    });
    const reload = async () => exclusive(async () => {
      if (!await discard()) return; doc.reset(await read()); await render();
    });
    registerTextSettings({ encoding: () => cp949 ? "cp949" : "utf", changeEncoding: async value => exclusive(async () => {
      if (!await discard()) return;
      doc.reset(await read()); cp949 = value === "cp949"; editing = false; edit.textContent = "편집"; await render();
    }) });
    const searchBar = document.createElement("div"); searchBar.className = "text-search va-search"; searchBar.hidden = true;
    const search = document.createElement("input"); search.type = "search"; search.placeholder = "검색"; search.setAttribute("aria-label", "텍스트 검색");
    const find = (back = false) => {
      const q = search.value; if (!q) return;
      const text = editor.value;
      const from = back ? editor.selectionStart - 1 : editor.selectionEnd;
      let at = back ? (from < 0 ? -1 : text.lastIndexOf(q, from)) : text.indexOf(q, from);
      if (at < 0) at = back ? text.lastIndexOf(q) : text.indexOf(q);
      status.textContent = at < 0 ? "검색 결과 없음" : `${at + 1}번째 문자`;
      if (at >= 0) {
        editor.focus(); editor.setSelectionRange(at, at + q.length);
        const row = (text.slice(0, at).match(/\n/g) ?? []).length;
        editor.scrollTop = row * parseFloat(getComputedStyle(editor).lineHeight) - editor.clientHeight / 2;
      }
    };
    searchBar.append(search);
    for (const [label, back] of [["이전", true], ["다음", false]] as const) {
      const b = document.createElement("button"); b.textContent = label; b.onclick = () => find(back); searchBar.append(b);
    }
    search.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); find(e.shiftKey); } };
    const closeSearch = document.createElement("button"); closeSearch.textContent = "닫기";
    closeSearch.onclick = () => { searchBar.hidden = true; editor.focus(); }; searchBar.append(closeSearch);
    const showSearch = () => { searchBar.hidden = false; search.focus(); search.select(); };
    const run = (action: () => Promise<void>) => () => { void action().catch(report); };
    const menus = new Menubar([
      { label: "파일", accessKey: "f", items: [
        { label: "열기…", shortcut: "Ctrl+O", run: () => window.dispatchEvent(new CustomEvent("va:open")) },
        { label: "텍스트로 열기…", shortcut: "Ctrl+Shift+O", run: () => window.dispatchEvent(new CustomEvent("va:open", { detail: { text: true } })) },
        { separator: true },
        { label: "저장", shortcut: "Ctrl+S", run: run(async () => doSave()), disabled: () => !editing || busy || !meta },
        { label: "다른 이름으로 저장", run: run(doCopy), disabled: () => !editing || busy || !meta },
        { label: "다시 읽기", run: run(reload), disabled: () => busy },
      ] },
      { label: "보기", accessKey: "v", items: [{ label: "찾기…", shortcut: "Ctrl+F", run: showSearch }] },
    ]);
    bar.prepend(menus.root);
    root.append(bar, searchBar, status, editor); el.replaceChildren(root);
    const doSave = async () => exclusive(async () => {
      if (!editing || !meta || !dirty()) return;
      doc.edit(await encodeText(meta, editor.value));
      const result = await doc.save();
      if (result === "conflict") { status.textContent = "파일이 외부에서 변경되었거나 삭제되었습니다. 편집 내용을 유지합니다. 다른 이름으로 저장하거나 다시 읽으세요."; }
      else { meta = await decodeText(doc.bytes, cp949); status.textContent = "저장됨"; }
    });
    editor.oninput = () => { status.textContent = ""; refresh(); };
    window.addEventListener("keydown", e => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); if (!e.repeat) void doSave().catch(report); }
      if (e.ctrlKey && e.key.toLowerCase() === "f") { e.preventDefault(); showSearch(); }
      if (e.key === "Escape" && !searchBar.hidden) { searchBar.hidden = true; editor.focus(); }
      if (menus.handleKey(e)) return;
      if (editing && (e.key === "F5" || e.key.startsWith("Browser") || (e.ctrlKey && e.key.toLowerCase() === "r") || (e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)))) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    for (const event of ["mousedown", "mouseup"]) window.addEventListener(event, e => { if (editing && [3, 4].includes((e as MouseEvent).button)) e.preventDefault(); }, true);
    window.addEventListener("focus", () => { if (!dirty() && !busy) void exclusive(async () => { if (await doc.reload()) await render(); }).catch(report); });
    window.addEventListener("beforeunload", e => { if (!approved && (dirty() || busy)) e.preventDefault(); });
    registerUpdateGuard(() => dirty() || busy, value => { approved = value; });
    await platform.onCloseRequested(async () => !busy && (approved || await discard()));
    await render();
  },
};
export default viewer;
