import "./office.css";
import { renderAsync } from "docx-preview";
import { platform } from "../platform";
import type { Viewer } from "../registry";
import { documentBar } from "../ui/chrome";
import { errorMessage } from "../ui/strings";
import { checkOfficePackage } from "./zip-guard";
import { zoomControls } from "./zoom";

const MAX_BYTES = 100 * 1024 * 1024;
const PADDING = 24;

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("Word 파일이 100 MiB를 초과합니다.");
    const bytes = new Uint8Array(await platform.readFileRaw(path));
    checkOfficePackage(bytes, "Word");
    const root = document.createElement("div"); root.className = "office-root docx-root va-viewer";
    const bar = document.createElement("header");
    const status = document.createElement("span"); status.setAttribute("role", "status"); status.className = "va-status";
    const scroll = document.createElement("div"); scroll.className = "docx-scroll";
    const styles = document.createElement("div"); styles.hidden = true;
    const pages = document.createElement("div"); pages.className = "docx-pages";
    scroll.append(pages);
    try {
      await renderAsync(bytes, pages, styles, {
        className: "docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true,
        // Images and embedded fonts as data: URLs: the CSP allows data: fonts but not blob: ones.
        useBase64URL: true,
        // altChunk parts are raw HTML the renderer would put in an iframe; a viewer has no use for them.
        renderAltChunks: false, renderChanges: false, renderComments: false,
        renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
      });
    } catch (e) { throw new Error(`Word 파일을 읽을 수 없습니다: ${errorMessage(e)}`); }
    /** The widest page at 100%, measured once the pages are in the window. */
    let width = 0;
    const zoom = zoomControls(scroll, scale => { pages.style.zoom = String(scale); }, () =>
      width ? Math.min(1, (scroll.clientWidth - PADDING * 2) / width) : null);
    documentBar(bar, { controls: zoom.controls });
    status.textContent = "읽기 전용";
    root.append(bar, scroll, status, styles); el.replaceChildren(root);
    scroll.addEventListener("click", e => followLink(e, pages));
    width = Math.max(0, ...[...pages.querySelectorAll<HTMLElement>("section.docx")].map(page => page.offsetWidth));
    zoom.fit();
    let frame = 0;
    window.addEventListener("resize", () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => zoom.refit()); });
  },
};
export default viewer;

/**
 * Links in the document never navigate the window: `#bookmark` scrolls to it, web and mail
 * links open outside, anything else (files, scripts, other schemes) is ignored.
 */
export function followLink(e: MouseEvent, pages: HTMLElement) {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") ?? "";
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    const target = [...pages.querySelectorAll<HTMLElement>("[id], a[name]")].find(t => t.id === id || t.getAttribute("name") === id);
    target?.scrollIntoView({ block: "start" });
    return;
  }
  let url: URL;
  try { url = new URL(href); } catch { return; }
  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
    void platform.openExternal(url.href).catch(err => { void platform.alert(errorMessage(err)).catch(() => {}); });
  }
}
