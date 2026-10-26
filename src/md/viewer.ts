import "katex/dist/katex.min.css";
import "./md.css";
import { platform } from "../platform";
import type { Viewer } from "../registry";
import { decodeText, encodeText } from "./text";
import { renderMarkdown, resolveAsset } from "./render";
import { classifyLink } from "./links";
import { renderMermaid, watchTheme } from "./mermaid";
import { buildToc } from "./toc";
import { splitFrontmatter } from "./splice";
import { beforeWrite, bytesEqual, createRunner, planSave, shouldConfirmLeave, shouldReloadOnFocus, type Mode } from "./viewer-state";
import type { Editor } from "./editor";

const LEAVE_MESSAGE = "저장하지 않은 변경이 있습니다. 버리고 나갈까요?";
const REWRITE_MESSAGE = "원문 보존 불가 — 전체 재작성으로 저장할까요?";
const CONFLICT_MESSAGE = "다른 프로그램이 파일을 변경했습니다. 덮어쓸까요?";

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

const viewer: Viewer = {
  async mount(el, path) {
    /** The file bytes as last read or written; external changes are detected against them. */
    let known = await platform.readFile(path);
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
    root.className = "md-root";

    const bar = document.createElement("header");
    bar.className = "md-bar";
    const title = document.createElement("span");
    title.className = "md-title";
    title.textContent = name;
    const actions = document.createElement("span");
    actions.className = "md-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "md-toggle";
    toggle.textContent = "편집";
    toggle.title = "편집 모드 (Ctrl+E)";
    actions.append(toggle);
    bar.append(title, actions);
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
    el.replaceChildren(root);

    /** One mode switch, save or reload at a time; user actions arriving meanwhile are queued. */
    const tasks = createRunner((e) => platform.alert(String(e)));

    let disposeToc = () => {};
    /** `keepScroll`: a reload of changed content keeps the reader where they were (best effort). */
    const render = async (keepScroll = false) => {
      const scrollY = window.scrollY;
      const restore = () => {
        if (keepScroll) window.scrollTo(0, scrollY);
        else if (location.hash) scrollToId(location.hash);
      };
      try {
        const { html, headings } = await renderMarkdown(original, {
          baseDir,
          assetUrl: (abs) => platform.assetUrl(abs),
        });
        article.innerHTML = html;
        disposeToc();
        disposeToc = () => {};
        body.querySelector("nav.toc")?.remove();
        if (headings.length > 0) {
          const toc = buildToc(headings, article);
          disposeToc = toc.dispose;
          body.prepend(toc.nav);
        }
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
    const readDisk = () => platform.readFile(path).catch(() => null);

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
    const confirmLeave = async () => {
      refreshDirty();
      if (!shouldConfirmLeave({ mode, dirty })) return true;
      discardApproved = await platform.confirm(LEAVE_MESSAGE);
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
      const { createEditor } = await import("./editor");
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
      if (plan.kind === "rewrite" && !(await platform.confirm(REWRITE_MESSAGE))) {
        tasks.dropQueuedSave(); // a Ctrl+S queued behind the dialog would only ask the same again
        return;
      }
      if (
        beforeWrite(known, await readDisk()) === "confirm-overwrite" &&
        !(await platform.confirmDanger(CONFLICT_MESSAGE, "덮어쓰기"))
      ) {
        tasks.dropQueuedSave();
        return; // stays dirty: the edits are kept in the editor
      }
      const bytes = encodeText(plan.text, meta);
      await platform.writeFile(path, bytes);
      known = bytes;
      original = plan.text;
      baseline = edited;
      refreshDirty(); // typing may have continued while the dialog or write was pending
    };

    const requestSave = () => {
      if (mode !== "edit") return;
      tasks.save(save);
    };
    // Decided when it runs: a queued toggle acts on the mode and read-only state at that time.
    const toggleMode = () => {
      tasks.user(async () => {
        if (toggle.disabled) return;
        await (mode === "read" ? enterEdit() : leaveEdit());
      });
    };

    // Read mode follows changes other programs made while the window was in the background.
    const reloadIfChanged = async () => {
      const onDisk = await readDisk();
      if (!onDisk || !shouldReloadOnFocus({ mode, busy: false }, known, onDisk)) return;
      adopt(onDisk);
      await render(true);
    };
    window.addEventListener("focus", () => {
      if (mode === "read") tasks.background(reloadIfChanged);
    });

    toggle.addEventListener("click", toggleMode);
    // Capture phase: ProseMirror/CodeMirror must not swallow the app shortcuts.
    window.addEventListener(
      "keydown",
      (e) => {
        if (isKey(e, "e")) {
          e.preventDefault();
          e.stopPropagation();
          // A held key would queue enter-then-leave; only the first press counts.
          if (!e.repeat) toggleMode();
        } else if (isKey(e, "s")) {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) requestSave();
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
    article.addEventListener("auxclick", onLink); // middle-click must not navigate the webview
    // Links inside the editor are edited, not followed; never let them navigate the webview.
    const blockNav = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a")) e.preventDefault();
    };
    editorHost.addEventListener("click", blockNav);
    editorHost.addEventListener("auxclick", blockNav);

    watchTheme(() => {
      void renderMermaid(article);
    });
  },
};
export default viewer;
