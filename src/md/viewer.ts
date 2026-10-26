import "katex/dist/katex.min.css";
import "./md.css";
import { platform } from "../platform";
import type { Viewer } from "../registry";
import { decodeText } from "./text";
import { renderMarkdown, resolveAsset } from "./render";
import { renderMermaid } from "./mermaid";
import { buildToc } from "./toc";

const EXTERNAL = /^(https?:|mailto:)/i;
const MD_FILE = /\.(md|markdown)$/i;

function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function openInThisWindow(absPath: string) {
  location.search = "?file=" + encodeURIComponent(absPath);
}

function handleLinkClick(e: MouseEvent, baseDir: string) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href) return;
  e.preventDefault();
  if (href.startsWith("#")) {
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {}
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (EXTERNAL.test(href)) {
    void platform.openExternal(href);
  } else {
    const abs = resolveAsset(baseDir, href);
    if (abs && MD_FILE.test(abs)) openInThisWindow(abs);
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
      const { html, headings } = await renderMarkdown(decoded.text, {
        baseDir,
        assetUrl: (abs) => platform.assetUrl(abs),
      });
      article.innerHTML = html;
      body.querySelector("nav.toc")?.remove();
      if (headings.length > 0) body.prepend(buildToc(headings, article));
      await renderMermaid(article);
    };
    await render();

    article.addEventListener("click", (e) => handleLinkClick(e, baseDir));

    // Re-render diagrams when the theme changes.
    new MutationObserver(() => {
      void renderMermaid(article);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  },
};
export default viewer;
