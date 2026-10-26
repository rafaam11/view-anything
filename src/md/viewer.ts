import "katex/dist/katex.min.css";
import "./md.css";
import { platform } from "../platform";
import type { Viewer } from "../registry";
import { decodeText, encodeText } from "./text";
import { renderMarkdown, resolveAsset } from "./render";
import { renderMermaid, watchTheme } from "./mermaid";
import { buildToc } from "./toc";
import { splitFrontmatter } from "./splice";
import { planSave, shouldConfirmLeave, type Mode } from "./viewer-state";
import type { Editor } from "./editor";

const EXTERNAL = /^(https?:|mailto:)/i;
const MD_FILE = /\.(md|markdown)$/i;
const LEAVE_MESSAGE = "저장하지 않은 변경이 있습니다. 버리고 나갈까요?";
const REWRITE_MESSAGE = "원문 보존 불가 — 전체 재작성으로 저장할까요?";

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
  if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
}

function openInThisWindow(absPath: string, hash: string) {
  const current = new URLSearchParams(location.search).get("file");
  if (current === absPath) {
    scrollToId(hash);
    return;
  }
  location.assign(location.pathname + "?file=" + encodeURIComponent(absPath) + hash);
}

function handleLinkClick(e: MouseEvent, baseDir: string, confirmLeave: () => Promise<boolean>) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href) return;
  e.preventDefault();
  if (href.startsWith("#")) {
    scrollToId(href);
  } else if (EXTERNAL.test(href)) {
    void platform.openExternal(href);
  } else {
    const abs = resolveAsset(baseDir, href);
    const hashAt = href.indexOf("#");
    if (abs && MD_FILE.test(abs)) {
      void confirmLeave().then((ok) => {
        if (ok) openInThisWindow(abs, hashAt >= 0 ? href.slice(hashAt) : "");
      });
    }
  }
}

function isKey(e: KeyboardEvent, key: string): boolean {
  return e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === key;
}

const viewer: Viewer = {
  async mount(el, path) {
    const decoded = decodeText(await platform.readFile(path));
    const meta = { bom: decoded.bom, eol: decoded.eol };
    const baseDir = dirOf(path);
    const name = nameOf(path);

    /** The file content as last read or saved (LF-normalized). */
    let original = decoded.text;
    let mode: Mode = "read";
    let editor: Editor | null = null;
    /** Editor serialization of the saved body; edits are diffed against it. */
    let baseline = "";
    let dirty = false;
    let busy = false; // a mode switch or save is in flight

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

    if (decoded.readOnlyReason) {
      toggle.disabled = true;
      toggle.title = "읽기 전용: " + decoded.readOnlyReason;
      const banner = document.createElement("div");
      banner.className = "md-banner";
      banner.textContent = decoded.readOnlyReason;
      root.append(banner);
    }

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

    const render = async () => {
      try {
        const { html, headings } = await renderMarkdown(original, {
          baseDir,
          assetUrl: (abs) => platform.assetUrl(abs),
        });
        article.innerHTML = html;
        body.querySelector("nav.toc")?.remove();
        if (headings.length > 0) body.prepend(buildToc(headings, article));
        if (location.hash) scrollToId(location.hash);
        await renderMermaid(article);
        if (location.hash) scrollToId(location.hash); // diagrams change layout height
      } catch (e) {
        const err = document.createElement("div");
        err.className = "md-banner";
        err.textContent = "렌더링 실패: " + String(e);
        article.replaceChildren(err);
      }
    };
    await render();

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
    const confirmLeave = async () => {
      refreshDirty();
      return !shouldConfirmLeave({ mode, dirty }) || (await platform.confirm(LEAVE_MESSAGE));
    };

    const enterEdit = async () => {
      const { createEditor } = await import("./editor");
      editorHost.hidden = false;
      body.hidden = true;
      try {
        editor = await createEditor(editorHost, splitFrontmatter(original).body, {
          imageUrl: (src) => {
            const abs = resolveAsset(baseDir, src);
            return abs ? platform.assetUrl(abs) : src;
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
      mode = "edit";
      toggle.textContent = "읽기";
      toggle.title = "읽기 모드 (Ctrl+E)";
    };

    const leaveEdit = async () => {
      if (!(await confirmLeave())) return;
      editor?.destroy();
      editor = null;
      editorHost.replaceChildren();
      editorHost.hidden = true;
      body.hidden = false;
      mode = "read";
      setDirty(false);
      toggle.textContent = "편집";
      toggle.title = "편집 모드 (Ctrl+E)";
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
      if (plan.kind === "rewrite" && !(await platform.confirm(REWRITE_MESSAGE))) return;
      await platform.writeFile(path, encodeText(plan.text, meta));
      original = plan.text;
      baseline = edited;
      refreshDirty(); // typing may have continued while the dialog or write was pending
    };

    const run = (task: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      task()
        .catch((e) => platform.alert(String(e)))
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    const toggleMode = () => {
      if (toggle.disabled) return;
      run(mode === "read" ? enterEdit : leaveEdit);
    };

    toggle.addEventListener("click", toggleMode);
    // Capture phase: ProseMirror/CodeMirror must not swallow the app shortcuts.
    window.addEventListener(
      "keydown",
      (e) => {
        if (isKey(e, "e")) {
          e.preventDefault();
          e.stopPropagation();
          toggleMode();
        } else if (isKey(e, "s")) {
          e.preventDefault();
          e.stopPropagation();
          if (mode === "edit") run(save);
        }
      },
      true,
    );

    void platform.onCloseRequested(confirmLeave).catch(() => {});

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
