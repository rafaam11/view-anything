import "katex/dist/katex.min.css";
import "./md.css";
import { platform } from "../platform";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";
import { decodeText, encodeText } from "./text";
import { renderMarkdown, resolveAsset, type Heading } from "./render";
import { classifyLink } from "./links";
import { renderMermaid, watchTheme } from "./mermaid";
import { buildToc } from "./toc";
import { splitFrontmatter } from "./splice";
import { bytesEqual, createRunner, planSave, shouldConfirmLeave, shouldReloadOnFocus, type Mode } from "./viewer-state";
import { saveCopy } from "../data/save-copy";
import type { Editor } from "./editor";
import { documentBar } from "../ui/chrome";
import { applyPreferences, DEFAULTS, preferences } from "../settings/preferences";
import { addCodeCopyButtons, imagesReady } from "./decorate";
import { watchFile } from "./file-watch";
import { createFind } from "./find";
import { createWheelStepper, sizeShortcut, stepMdSize } from "./font-size";

const LEAVE_MESSAGE = "저장하지 않은 변경이 있습니다. 버리고 나갈까요?";
const REWRITE_MESSAGE = "원문 보존 불가 — 전체 재작성으로 저장할까요?";
const CONFLICT_MESSAGE = "파일이 변경되었거나 읽을 수 없습니다. 편집 내용을 유지합니다. 다른 이름으로 저장하거나 읽기 모드에서 다시 여세요.";
/** Same cap as the text viewer: the file is read whole into the webview and rendered at once. */
const MAX_BYTES = 10 * 1024 * 1024;

function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function scrollToId(raw: string) {
  let id = raw.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {}
  // Sanitized raw-HTML ids/names and footnotes carry the "user-content-" prefix (see render.ts).
  if (id) (document.getElementById(id) ?? document.getElementById("user-content-" + id))?.scrollIntoView({ block: "start" });
}

function openInThisWindow(absPath: string, hash: string) {
  const current = new URLSearchParams(location.search).get("file");
  if (current === absPath) {
    scrollToId(hash);
    return;
  }
  location.assign(location.pathname + "?file=" + encodeURIComponent(absPath) + hash);
}

/** A missing target only gets a notice: the window must never end up on a dead error page. */
async function ensureExists(path: string): Promise<boolean> {
  if (await platform.pathExists(path)) return true;
  await platform.notice("링크 대상을 찾을 수 없습니다:\n" + path);
  return false;
}

async function followLink(href: string, baseDir: string, confirmLeave: () => Promise<boolean>) {
  const link = classifyLink(href, baseDir);
  switch (link.kind) {
    case "anchor":
      scrollToId(link.hash);
      break;
    case "external":
      await platform.openExternal(link.url);
      break;
    case "markdown":
      if ((await ensureExists(link.path)) && (await confirmLeave())) openInThisWindow(link.path, link.hash);
      break;
    case "open":
      if (await ensureExists(link.path)) await platform.openWithDefaultApp(link.path);
      break;
    case "blocked":
      await platform.notice("보안을 위해 실행 파일 링크는 열지 않습니다:\n" + link.path);
      break;
    case "ignore":
      break;
  }
}

function handleLinkClick(e: MouseEvent, baseDir: string, confirmLeave: () => Promise<boolean>) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href) return;
  e.preventDefault();
  followLink(href, baseDir, confirmLeave).catch((err) => platform.alert(String(err)).catch(() => {}));
}

/** Webview accelerators that leave or reload the page. */
function isReloadOrHistoryKey(e: KeyboardEvent): boolean {
  if (e.key === "BrowserBack" || e.key === "BrowserForward" || e.key === "BrowserRefresh" || e.key === "F5") return true;
  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return true;
  return e.ctrlKey && e.key.toLowerCase() === "r";
}

function isKey(e: KeyboardEvent, key: string): boolean {
  return e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === key;
}

const hasOpenDialog = () => document.querySelector("dialog[open]") !== null;

export function createViewer(loadEditor: () => Promise<Pick<typeof import("./editor"), "createEditor">> = () => import("./editor")): Viewer {
return {
  async mount(el, path) {
    /** Raw-bytes read behind a size check, like every other viewer (no JSON number arrays). */
    const readBytes = async () => {
      if (await platform.fileSize(path) > MAX_BYTES) throw new Error("Markdown 파일이 10 MiB를 초과합니다.");
      return new Uint8Array(await platform.readFileRaw(path));
    };
    /** The file bytes as last read or written; external changes are detected against them. */
    let known: Uint8Array = await readBytes();
    const decoded = decodeText(known);
    const meta = { bom: decoded.bom, eol: decoded.eol };
    const baseDir = dirOf(path);
    const name = nameOf(path);
    void platform.setWindowTitle(name).catch(() => {});

    /** The file content as last read or saved (LF-normalized). */
    let original = decoded.text;
    let mode: Mode = "read";
    let editor: Editor | null = null;
    /** Editor serialization of the saved body; edits are diffed against it. */
    let baseline = "";
    let dirty = false;

    const root = document.createElement("div");
    root.className = "md-root va-viewer";

    const bar = document.createElement("header");
    bar.className = "md-bar";
    const title = document.createElement("span");
    title.className = "md-title";
    title.textContent = name;
    const actions = document.createElement("span");
    actions.className = "md-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "md-toggle md-mode-toggle";
    toggle.textContent = "편집";
    toggle.title = "편집 모드 (Ctrl+E)";
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "md-toggle"; copy.textContent = "다른 이름으로 저장"; copy.hidden = true;
    const saveButton = document.createElement("button"); saveButton.textContent = "저장"; saveButton.hidden = true;
    /** The shared setting, so it also follows in other open Markdown windows and stays for next time. */
    const changeSize = (step: 1 | -1 | 0) => {
      const current = preferences().mdSize;
      const next = step === 0 ? DEFAULTS.mdSize : stepMdSize(current, step);
      if (next === current) return;
      const ratio = el.scrollHeight ? el.scrollTop / el.scrollHeight : 0;
      applyPreferences({ mdSize: next });
      el.scrollTop = ratio * el.scrollHeight;
    };
    const menus = documentBar(bar, { toggle, files: [saveButton, copy], view: [
      { label: "목차", checked: () => !root.querySelector(".toc")?.classList.contains("collapsed"), run: () => root.querySelector<HTMLButtonElement>(".toc-toggle")?.click() },
      { label: "찾기…", shortcut: "Ctrl+F", disabled: () => mode !== "read", run: () => find.open() },
      { separator: true },
      { label: "글자 크게", shortcut: "Ctrl+=", run: () => changeSize(1) },
      { label: "글자 작게", shortcut: "Ctrl+-", run: () => changeSize(-1) },
      { label: "글자 크기 원래대로", shortcut: "Ctrl+0", run: () => changeSize(0) },
    ] });
    root.append(bar);

    const banner = document.createElement("div");
    banner.className = "md-banner";
    root.append(banner);
    const setReadOnly = (reason: string | undefined) => {
      toggle.disabled = !!reason;
      toggle.title = reason ? "읽기 전용: " + reason : "편집 모드 (Ctrl+E)";
      banner.hidden = !reason;
      banner.textContent = reason ?? "";
    };
    setReadOnly(decoded.readOnlyReason);

    const body = document.createElement("div");
    body.className = "md-body";
    const article = document.createElement("article");
    article.className = "md-content";
    body.append(article);
    root.append(body);
    const editorHost = document.createElement("div");
    editorHost.className = "md-editor";
    editorHost.hidden = true;
    root.append(editorHost);
    const find = createFind(article);
    root.append(find.element);
    el.replaceChildren(root);

    /** One mode switch, save or reload at a time; user actions arriving meanwhile are queued. */
    const tasks = createRunner((e) => platform.alert(String(e)));

    const decorate = (target: ParentNode) => addCodeCopyButtons(
      target,
      (text) => platform.copyText(text),
      (e) => { void platform.alert(String(e)).catch(() => {}); },
    );
    let disposeToc = () => {};
    /** Needs the article in the document: the toc looks its headings up by id. */
    const showToc = (headings: Heading[]) => {
      disposeToc();
      disposeToc = () => {};
      body.querySelector("nav.toc")?.remove();
      if (headings.length > 0) {
        const toc = buildToc(headings, article, el);
        disposeToc = toc.dispose;
        body.prepend(toc.nav);
      }
    };
    /** Bumped on a theme change, which renders the diagrams of the article on screen only. */
    let themeEpoch = 0;
    /**
     * `keepScroll`: a reload of changed content keeps the reader where they were (best effort). The
     * new content is finished off-screen and swapped in at once, because a file watched while it is
     * being written reloads often: the reader must see neither diagram source nor the page shifting.
     */
    const render = async (keepScroll = false) => {
      let scrollY = el.scrollTop;
      const restore = () => {
        if (keepScroll) el.scrollTo(0, scrollY);
        else if (location.hash) scrollToId(location.hash);
      };
      try {
        const { html, headings } = await renderMarkdown(original, {
          baseDir,
          assetUrl: (abs) => platform.assetUrl(abs),
        });
        if (keepScroll) {
          const next = document.createElement("div");
          next.innerHTML = html;
          const opened = [...article.querySelectorAll("details")].map((d) => d.open);
          next.querySelectorAll("details").forEach((d, i) => { d.open = opened[i] ?? d.open; });
          decorate(next);
          const epoch = themeEpoch;
          await renderMermaid(next);
          await imagesReady(next);
          scrollY = el.scrollTop; // the reader may have kept scrolling meanwhile
          article.replaceChildren(...next.childNodes);
          showToc(headings);
          find.refresh();
          restore();
          if (epoch !== themeEpoch) {
            await renderMermaid(article);
            restore();
          }
          return;
        }
        article.innerHTML = html;
        decorate(article);
        showToc(headings);
        find.refresh();
        restore();
        await renderMermaid(article);
        restore(); // diagrams change layout height
      } catch (e) {
        const err = document.createElement("div");
        err.className = "md-banner";
        err.textContent = "렌더링 실패: " + String(e);
        article.replaceChildren(err);
      }
    };
    await render();

    /** Adopt bytes another program wrote: new content, encoding details and read-only state. */
    const adopt = (bytes: Uint8Array) => {
      const d = decodeText(bytes);
      known = bytes;
      original = d.text;
      meta.bom = d.bom;
      meta.eol = d.eol;
      setReadOnly(d.readOnlyReason);
      return d;
    };
    /** Current disk bytes, or null when the file cannot be read (deleted, locked). */
    const readDisk = () => readBytes().catch(() => null);

    const setDirty = (value: boolean) => {
      if (value === dirty) return;
      dirty = value;
      const t = (dirty ? "● " : "") + name;
      title.textContent = t;
      void platform.setWindowTitle(t).catch(() => {});
    };
    /** Exact dirtiness right now (the change listener is debounced). */
    const refreshDirty = () => {
      if (editor) setDirty(editor.getMarkdown() !== baseline);
      return dirty;
    };
    /** The user agreed to drop unsaved edits; the page may unload without asking again. */
    let discardApproved = false;
    registerUpdateGuard(refreshDirty, (value) => { discardApproved = value; });
    const confirmLeave = async () => {
      refreshDirty();
      if (!shouldConfirmLeave({ mode, dirty })) return true;
      discardApproved = await platform.confirmDiscard(LEAVE_MESSAGE);
      return discardApproved;
    };

    const enterEdit = async () => {
      // Edit what is on disk now, not what was read at mount (an agent may have changed it).
      const onDisk = await readDisk();
      if (onDisk && !bytesEqual(known, onDisk)) {
        const d = adopt(onDisk);
        await render(true);
        if (d.readOnlyReason) return;
      }
      find.close(); // its marks and panel belong to the read view
      const { createEditor } = await loadEditor();
      editorHost.hidden = false;
      body.hidden = true;
      try {
        editor = await createEditor(editorHost, splitFrontmatter(original).body, {
          imageUrl: (src) => {
            const abs = resolveAsset(baseDir, src);
            if (abs) return platform.assetUrl(abs);
            // Same rule as read mode: a refused (foreign UNC) or odd path is not handed to the webview.
            return /^(https?:\/\/|data:image\/)/i.test(src) ? src : "";
          },
          // Ignore updates that arrive before `baseline` belongs to this editor.
          onChange: (md) => {
            if (editor) setDirty(md !== baseline);
          },
        });
      } catch (e) {
        editorHost.hidden = true;
        editorHost.replaceChildren();
        body.hidden = false;
        throw e;
      }
      baseline = editor.getMarkdown();
      discardApproved = false;
      mode = "edit";
      copy.hidden = false;
      saveButton.hidden = false;
      toggle.textContent = "읽기";
      toggle.title = "읽기 모드 (Ctrl+E)";
    };

    const leaveEdit = async () => {
      if (!(await confirmLeave())) return;
      // Discarded edits were based on what we read; show what is on disk now.
      const onDisk = await readDisk();
      if (onDisk && !bytesEqual(known, onDisk)) adopt(onDisk);
      editor?.destroy();
      editor = null;
      editorHost.replaceChildren();
      editorHost.hidden = true;
      body.hidden = false;
      mode = "read";
      copy.hidden = true;
      saveButton.hidden = true;
      setDirty(false);
      toggle.textContent = "편집";
      // adopt() above may have made the file read-only; keep its explanation.
      if (!toggle.disabled) toggle.title = "편집 모드 (Ctrl+E)";
      await render();
    };

    const save = async () => {
      if (!editor) return;
      const edited = editor.getMarkdown();
      const plan = planSave(original, baseline, edited);
      if (plan.kind === "unchanged") {
        setDirty(false);
        return;
      }
      if (plan.kind === "rewrite" && !(await platform.confirmDanger(`${REWRITE_MESSAGE}\n\n사유: ${plan.reason}`, "전체 다시 쓰기"))) {
        tasks.dropQueuedSave(); // a Ctrl+S queued behind the dialog would only ask the same again
        return;
      }
      const onDisk = await readDisk();
      if (!onDisk || !bytesEqual(known, onDisk)) {
        await platform.alert(CONFLICT_MESSAGE);
        tasks.dropQueuedSave();
        return;
      }
      const bytes = encodeText(plan.text, meta);
      if (!await platform.writeFileChecked(path, known, bytes)) {
        await platform.alert(CONFLICT_MESSAGE);
        tasks.dropQueuedSave();
        return;
      }
      known = bytes;
      original = plan.text;
      baseline = edited;
      refreshDirty(); // typing may have continued while the dialog or write was pending
    };

    const requestSave = () => {
      if (mode !== "edit") return;
      tasks.save(save);
    };
    saveButton.onclick = requestSave;
    copy.addEventListener("click", () => tasks.user(async () => {
      if (!editor) return;
      const plan = planSave(original, baseline, editor.getMarkdown());
      if (plan.kind === "rewrite" && !(await platform.confirmDanger(`${REWRITE_MESSAGE}\n\n사유: ${plan.reason}`, "전체 다시 쓰기"))) return;
      const text = plan.kind === "unchanged" ? original : plan.text;
      if (await saveCopy(path, encodeText(text, meta))) await platform.notice("복사본을 저장했습니다. 원본 편집 내용은 그대로 유지합니다.");
    }));
    // Decided when it runs: a queued toggle acts on the mode and read-only state at that time.
    const toggleMode = () => {
      tasks.user(async () => {
        if (toggle.disabled) return;
        await (mode === "read" ? enterEdit() : leaveEdit());
      });
    };

    // Read mode follows changes other programs made, whether or not the window is active. The bytes
    // decide: a file that was only touched is not drawn again.
    const reloadIfChanged = async () => {
      const onDisk = await readDisk();
      if (!onDisk) {
        watch.retry();
        return;
      }
      if (!shouldReloadOnFocus({ mode, busy: false }, known, onDisk)) return;
      adopt(onDisk);
      await render(true);
    };
    /** A reload would drop a selection the reader is about to copy, so it waits for them. */
    const selectingText = () => {
      const selection = getSelection();
      return !!selection && !selection.isCollapsed && article.contains(selection.anchorNode);
    };
    const watch = watchFile({
      stat: () => platform.fileStat(path),
      paused: () => mode !== "read" || tasks.busy || selectingText(),
      changed: () => tasks.background(reloadIfChanged),
      alive: () => root.isConnected,
    });
    // Activating the window looks at the stamp at once; the bytes are read only when it changed.
    window.addEventListener("focus", () => {
      if (mode === "read") watch.kick();
    });

    toggle.addEventListener("click", toggleMode);
    const wheelStep = createWheelStepper();
    // Not passive: Ctrl+wheel would otherwise zoom the whole webview, title bar included.
    root.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const step = wheelStep(e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY);
      if (step) changeSize(step);
    }, { passive: false });
    // Capture phase: ProseMirror/CodeMirror must not swallow the app shortcuts.
    window.addEventListener(
      "keydown",
      (e) => {
        if (isKey(e, "e")) {
          if (hasOpenDialog()) return;
          e.preventDefault();
          e.stopPropagation();
          // A held key would queue enter-then-leave; only the first press counts.
          if (!e.repeat) toggleMode();
        } else if (isKey(e, "s")) {
          if (hasOpenDialog()) return;
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) requestSave();
        } else if (sizeShortcut(e) !== null) {
          if (hasOpenDialog()) return;
          e.preventDefault();
          e.stopPropagation();
          changeSize(sizeShortcut(e)!);
        } else if (isKey(e, "f")) {
          // Edit mode keeps the editor's own behaviour for this key.
          if (mode !== "read" || hasOpenDialog()) return;
          e.preventDefault();
          e.stopPropagation();
          find.open();
        } else if (e.key === "Escape" && find.isOpen && !menus.isOpen && !hasOpenDialog()) {
          e.preventDefault();
          e.stopPropagation();
          find.close();
        } else if (mode === "edit" && isReloadOrHistoryKey(e)) {
          // Back/forward/reload would unload the page and drop the editor state.
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );

    // Mouse back/forward buttons navigate the webview history.
    const blockHistoryButtons = (e: MouseEvent) => {
      if (mode === "edit" && (e.button === 3 || e.button === 4)) e.preventDefault();
    };
    window.addEventListener("mousedown", blockHistoryButtons, true);
    window.addEventListener("mouseup", blockHistoryButtons, true);
    // Last line of defence for any other unload (history, reload) with unsaved edits.
    window.addEventListener("beforeunload", (e) => {
      refreshDirty();
      if (!discardApproved && shouldConfirmLeave({ mode, dirty })) e.preventDefault();
    });

    platform.onCloseRequested(confirmLeave).catch((e) => console.error("close guard not installed:", e));

    const onLink = (e: MouseEvent) => handleLinkClick(e, baseDir, confirmLeave);
    article.addEventListener("click", onLink);
    // Middle-click must not navigate the webview; the right button belongs to the context menu.
    article.addEventListener("auxclick", (e) => {
      if (e.button === 1 && (e.target as HTMLElement).closest("a")) e.preventDefault();
    });
    // Links inside the editor are edited, not followed; never let them navigate the webview.
    const blockNav = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a")) e.preventDefault();
    };
    editorHost.addEventListener("click", blockNav);
    editorHost.addEventListener("auxclick", blockNav);

    watchTheme(() => {
      themeEpoch++;
      void renderMermaid(article);
    });
  },
};
}
export default createViewer();
