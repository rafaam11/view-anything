import "./viewer.css";
import { platform } from "../platform";
import { FileDocument } from "../data/document";
import { saveCopy } from "../data/save-copy";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";
import { decodeHint, decodeText, encodeText, normalize, lineEndings, type TextMeta } from "./codec";
import { documentBar } from "../ui/chrome";
import { registerTextSettings } from "../settings/document";
import { preferences } from "../settings/preferences";
import { revealSelection } from "./selection";
import { highlightHtml, languageFor, LIVE_HIGHLIGHT_CHARS, withinHighlightLimit } from "./highlight";
import "../ui/chrome.css";
import { textButton } from "../ui/icons";
import { findBar } from "../ui/find-bar";
import { toast } from "../ui/toast";
import { CONFLICT_RELOAD, COPY_SAVED, DISCARD, DISCARD_CLOSE, DISCARD_RELOAD, SAVED, errorMessage } from "../ui/strings";

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
    let meta: TextMeta | null = null, editing = false, busy = false, approved = false, cp949 = false, searchSequence = 0;
    const name = path.split(/[\\/]/).pop() ?? path;
    const root = document.createElement("section"); root.className = "text-root va-viewer";
    const bar = document.createElement("header"); bar.className = "text-bar va-viewer-toolbar";
    const button = (label: string, run: () => Promise<void>) => {
      const b = textButton(label);
      b.onclick = () => { void run().catch(report); }; return b;
    };
    const status = document.createElement("p"); status.setAttribute("role", "status");
    const report = (e: unknown) => { status.textContent = errorMessage(e); };
    const editor = document.createElement("textarea"); editor.className = "text-source";
    editor.spellcheck = false; editor.readOnly = true; editor.setAttribute("aria-label", "텍스트 내용");
    // Syntax colours: a <pre> under the textarea shows the same text, highlighted; the textarea
    // keeps editing, selection and search and only its glyphs turn transparent.
    const stack = document.createElement("div"); stack.className = "text-stack";
    const layer = document.createElement("pre"); layer.className = "text-highlight"; layer.setAttribute("aria-hidden", "true");
    stack.append(layer, editor);
    const language = languageFor(path);
    let paintSequence = 0, paintTimer: ReturnType<typeof setTimeout> | undefined;
    const plain = () => { stack.removeAttribute("data-highlight"); layer.replaceChildren(); };
    // The mirrored box (scrollbars, padding) depends only on whether this file can be coloured, so
    // it stays put while colours blink off during typing.
    const mirror = () => { if (language && preferences().textHighlight) stack.dataset.mirror = "on"; else stack.removeAttribute("data-mirror"); };
    const syncScroll = () => { layer.scrollTop = editor.scrollTop; layer.scrollLeft = editor.scrollLeft; };
    /** `live`: a repaint after a typing pause, skipped for big edits until the next save. */
    const paint = async (live = false) => {
      clearTimeout(paintTimer);
      const sequence = ++paintSequence, text = editor.value;
      mirror();
      if (!language || !meta || !preferences().textHighlight) { plain(); return; }
      if (live && text.length > LIVE_HIGHLIGHT_CHARS) { plain(); return; }
      if (!withinHighlightLimit(text)) {
        plain();
        if (!status.textContent) status.textContent = "구문 강조는 100만 자·2만 줄까지 적용합니다";
        return;
      }
      try {
        const html = await highlightHtml(text, language);
        if (sequence !== paintSequence) return;
        layer.innerHTML = html + (text.endsWith("\n") ? " " : ""); // keep the last empty line's height
        stack.dataset.highlight = "on"; syncScroll();
      } catch { if (sequence === paintSequence) plain(); }
    };
    editor.addEventListener("scroll", syncScroll);
    const finder = findBar({
      label: "텍스트 검색",
      step: (back) => { void find(back).catch(report); },
      input: () => cancelSearch(),
      close: () => { cancelSearch(); editor.focus(); },
    });
    const cancelSearch = () => { searchSequence++; if (finder.count.textContent === "검색 중…") finder.count.textContent = ""; };
    const display = () => {
      cancelSearch(); editor.wrap = preferences().textWrap ? "soft" : "off"; stack.dataset.wrap = editor.wrap;
      if (meta) void paint();
    };
    display(); window.addEventListener("va:preferences", display);
    window.addEventListener("resize", cancelSearch);
    window.addEventListener("unload", () => { cancelSearch(); window.removeEventListener("va:preferences", display); window.removeEventListener("resize", cancelSearch); }, { once: true });
    const dirty = () => doc.dirty || (meta !== null && editor.value !== normalize(meta.text));
    const refresh = () => {
      void platform.setWindowTitle((dirty() ? "● " : "") + name).catch(() => {});
      edit.disabled = busy || !meta || lineEndings(meta.text).mixed;
      editor.readOnly = !editing || busy;
    };
    const render = async () => {
      cancelSearch();
      meta = null; editor.value = "";
      try {
        meta = await decodeText(doc.bytes, cp949); editor.value = normalize(meta.text);
        const { mixed } = lineEndings(meta.text);
        if (mixed) { editing = false; edit.textContent = "편집"; }
        status.textContent = mixed ? "혼합 줄바꿈 · 읽기 전용" : "";
      } catch (e) { editing = false; edit.textContent = "편집"; report(decodeHint(e)); }
      refresh();
      await paint();
    };
    const exclusive = async (run: () => Promise<void>) => {
      if (busy || approved) return; busy = true; refresh();
      try { await run(); } finally { busy = false; refresh(); }
    };
    const discard = async (text = DISCARD, label = "버리기") => !dirty() || await platform.confirmDiscard(text, label);
    const edit = button("편집", async () => exclusive(async () => {
      if (!meta || lineEndings(meta.text).mixed || !await discard()) return;
      doc.reset(await read()); editing = !editing; edit.textContent = editing ? "읽기" : "편집";
      await render();
    }));
    const doCopy = async () => exclusive(async () => {
      if (!editing || !meta) return;
      const bytes = dirty() ? await encodeText(meta, editor.value) : doc.bytes;
      if (await saveCopy(path, bytes)) toast(COPY_SAVED);
    });
    const reload = async () => exclusive(async () => {
      if (!await discard(DISCARD_RELOAD, "다시 읽기")) return; doc.reset(await read()); await render();
    });
    registerTextSettings({ encoding: () => cp949 ? "cp949" : "utf", changeEncoding: async value => exclusive(async () => {
      if (!await discard(DISCARD_RELOAD, "다시 읽기")) return;
      doc.reset(await read()); cp949 = value === "cp949"; editing = false; edit.textContent = "편집"; await render();
    }) });
    const search = finder.input;
    const find = async (back = false) => {
      const sequence = ++searchSequence;
      const q = search.value; if (!q) return;
      const text = editor.value;
      const from = back ? editor.selectionStart - 1 : editor.selectionEnd;
      let at = back ? (from < 0 ? -1 : text.lastIndexOf(q, from)) : text.indexOf(q, from);
      if (at < 0) at = back ? text.lastIndexOf(q) : text.indexOf(q);
      finder.count.textContent = at < 0 ? "결과 없음" : "검색 중…";
      if (at >= 0) {
        editor.focus(); editor.setSelectionRange(at, at + q.length);
        const current = () => sequence === searchSequence && editor.selectionStart === at && editor.selectionEnd === at + q.length;
        if (await revealSelection(editor, at, q.length, current)) finder.count.textContent = `${at + 1}번째 문자`;
        else if (sequence === searchSequence) finder.count.textContent = "";
      }
    };
    const showSearch = finder.open;
    const run = (action: () => Promise<void>) => () => { void action().catch(report); };
    documentBar(bar, {
      toggle: edit,
      actions: [
        { label: "저장", shortcut: "Ctrl+S", run: run(async () => doSave()), disabled: () => !editing || busy || !meta },
        { label: "다른 이름으로 저장…", run: run(doCopy), disabled: () => !editing || busy || !meta },
        { label: "다시 읽기", run: run(reload), disabled: () => busy },
      ],
      view: [{ label: "찾기…", shortcut: "Ctrl+F", run: showSearch }],
    });
    root.append(bar, finder.element, status, stack); el.replaceChildren(root);
    const doSave = async () => exclusive(async () => {
      if (!editing || !meta || !dirty()) return;
      doc.edit(await encodeText(meta, editor.value));
      const result = await doc.save();
      if (result === "conflict") { status.textContent = ""; await platform.notice(CONFLICT_RELOAD, "warning"); }
      else { meta = await decodeText(doc.bytes, cp949); status.textContent = ""; toast(SAVED); void paint(); }
    });
    editor.oninput = () => {
      cancelSearch(); status.textContent = ""; refresh();
      // Plain glyphs while typing, colours again after a short pause: the layer never lags behind the caret.
      ++paintSequence; if (stack.dataset.highlight) plain();
      clearTimeout(paintTimer); paintTimer = setTimeout(() => { void paint(true); }, 150);
    };
    window.addEventListener("keydown", e => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); if (!e.repeat) void doSave().catch(report); }
      if (e.ctrlKey && e.key.toLowerCase() === "f") { e.preventDefault(); showSearch(); }
      if (e.key === "Escape" && finder.isOpen) finder.close();
      if (editing && (e.key === "F5" || e.key.startsWith("Browser") || (e.ctrlKey && e.key.toLowerCase() === "r") || (e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)))) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    for (const event of ["mousedown", "mouseup"]) window.addEventListener(event, e => { if (editing && [3, 4].includes((e as MouseEvent).button)) e.preventDefault(); }, true);
    window.addEventListener("focus", () => { if (!dirty() && !busy) void exclusive(async () => { if (await doc.reload()) await render(); }).catch(report); });
    window.addEventListener("beforeunload", e => { if (!approved && (dirty() || busy)) e.preventDefault(); });
    registerUpdateGuard(() => dirty() || busy, value => { approved = value; });
    await platform.onCloseRequested(async () => !busy && (approved || await discard(DISCARD_CLOSE, "닫기")));
    await render();
  },
};
export default viewer;
