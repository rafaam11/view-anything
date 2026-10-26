import "katex/dist/katex.min.css";
import "./md.css";
import { platform } from "../platform";
import type { Viewer } from "../registry";
import { decodeText } from "./text";
import { renderMarkdown, resolveAsset } from "./render";
import { renderMermaid, watchTheme } from "./mermaid";
import { buildToc } from "./toc";

const EXTERNAL = /^(https?:|mailto:)/i;
const MD_FILE = /\.(md|markdown)$/i;

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

function handleLinkClick(e: MouseEvent, baseDir: string) {
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
    if (abs && MD_FILE.test(abs)) openInThisWindow(abs, hashAt >= 0 ? href.slice(hashAt) : "");
  }
}

const viewer: Viewer = {
  async mount(el, path) {
    const decoded = decodeText(await platform.readFile(path));
    const baseDir = dirOf(path);

    const root = document.createElement("div");
    root.className = "md-root";

    // Top bar: title now; the Task 5 edit-mode toggle goes into `actions`.
    const bar = document.createElement("header");
    bar.className = "md-bar";
    const title = document.createElement("span");
    title.className = "md-title";
    title.textContent = nameOf(path);
    const actions = document.createElement("span");
    actions.className = "md-actions";
    bar.append(title, actions);
    root.append(bar);

    if (decoded.readOnlyReason) {
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
    el.replaceChildren(root);

    const render = async () => {
      try {
        const { html, headings } = await renderMarkdown(decoded.text, {
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

    const onLink = (e: MouseEvent) => handleLinkClick(e, baseDir);
    article.addEventListener("click", onLink);
    article.addEventListener("auxclick", onLink); // middle-click must not navigate the webview

    watchTheme(() => {
      void renderMermaid(article);
    });
  },
};
export default viewer;
