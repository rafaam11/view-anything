import "./office.css";
import { renderAsync } from "docx-preview";
import { createFind } from "../md/find";
import { platform } from "../platform";
import type { Viewer } from "../registry";
import { documentBar } from "../ui/chrome";
import { textButton } from "../ui/icons";
import { errorMessage } from "../ui/strings";
import { headingStyles, styleClass } from "./docx-outline";
import { followLink } from "./links";
import { checkOfficePackage } from "./zip-guard";
import { officeStatusBar } from "./zoom";

const MAX_BYTES = 100 * 1024 * 1024;
const PADDING = 24;

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("Word 파일이 100 MiB를 초과합니다.");
    const bytes = new Uint8Array(await platform.readFileRaw(path));
    checkOfficePackage(bytes, "Word");
    const root = document.createElement("div"); root.className = "office-root docx-root va-viewer"; root.dataset.office = "word";
    const bar = document.createElement("header");
    const body = document.createElement("div"); body.className = "office-body";
    const nav = document.createElement("nav"); nav.className = "office-pane docx-nav"; nav.setAttribute("aria-label", "탐색");
    const navTitle = document.createElement("h2"); navTitle.className = "office-pane-title"; navTitle.textContent = "탐색";
    const navList = document.createElement("div"); navList.className = "docx-nav-list";
    nav.append(navTitle, navList);
    const scroll = document.createElement("div"); scroll.className = "docx-scroll";
    const styles = document.createElement("div"); styles.hidden = true;
    const pages = document.createElement("div"); pages.className = "docx-pages";
    scroll.append(pages); body.append(nav, scroll);
    let levels: Map<string, number>;
    try {
      [levels] = await Promise.all([
        headingStyles(bytes).catch(() => new Map<string, number>()),
        renderAsync(bytes, pages, styles, {
          className: "docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true,
          // Images and embedded fonts as data: URLs: the CSP allows data: fonts but not blob: ones.
          useBase64URL: true,
          // altChunk parts are raw HTML the renderer would put in an iframe; a viewer has no use for them.
          renderAltChunks: false, renderChanges: false, renderComments: false,
          renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        }),
      ]);
    } catch (e) { throw new Error(`Word 파일을 읽을 수 없습니다: ${errorMessage(e)}`); }
    /** The widest page at 100%, measured once the pages are in the window. */
    let width = 0;
    const status = officeStatusBar(scroll, scale => { pages.style.zoom = String(scale); showPosition(); }, () =>
      width ? Math.min(1, (scroll.clientWidth - PADDING * 2) / width) : null);
    const find = createFind(pages);
    const showNav = () => { nav.hidden = !nav.hidden; if (!nav.hidden) markHeading(); };
    documentBar(bar, { view: [
      { label: "찾기…", shortcut: "Ctrl+F", run: () => find.open() },
      { label: "탐색 창", checked: () => !nav.hidden, run: showNav },
    ] });
    root.append(bar, find.element, body, status.element, styles); el.replaceChildren(root);
    scroll.addEventListener("click", e => followLink(e, pages));
    window.addEventListener("keydown", e => {
      if (document.querySelector("dialog[open]")) return;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") { e.preventDefault(); find.open(); }
      else if (e.key === "Escape" && find.isOpen) find.close();
    });

    const sections = [...pages.querySelectorAll<HTMLElement>("section.docx")];
    const words = (pages.textContent ?? "").split(/\s+/).filter(Boolean).length;
    const headings = outline(pages, levels);
    const items = headings.map(({ element, level, text }) => {
      const b = textButton(text, "ghost"); b.classList.add("docx-nav-item"); b.style.paddingInlineStart = `${8 + (level - 1) * 14}px`;
      b.title = text; b.onclick = () => element.scrollIntoView({ block: "start" });
      navList.append(b);
      return b;
    });
    if (!headings.length) {
      const empty = document.createElement("p"); empty.className = "office-pane-empty";
      empty.textContent = "문서에 제목이 없습니다. 제목 스타일을 쓴 문단이 여기에 표시됩니다.";
      navList.append(empty);
    }
    // The pane opens only when the document has headings to list; 보기 > 탐색 창 shows it anyway.
    nav.hidden = !headings.length;
    /** The page and heading at the top third of the window, as Word's status bar and pane follow them. */
    const probe = () => scroll.getBoundingClientRect().top + scroll.clientHeight / 3;
    const markHeading = () => {
      if (nav.hidden || !headings.length) return;
      const y = probe();
      let current = 0;
      headings.forEach((h, i) => { if (h.element.getBoundingClientRect().top <= y) current = i; });
      items.forEach((b, i) => b.setAttribute("aria-current", i === current ? "true" : "false"));
    };
    const showPosition = () => {
      const y = probe();
      let page = 0;
      sections.forEach((s, i) => { if (s.getBoundingClientRect().top <= y) page = i; });
      status.info([`${sections.length}페이지 중 ${page + 1}페이지`, `단어 ${words.toLocaleString()}개`, "읽기 전용"]);
      markHeading();
    };
    let frame = 0;
    scroll.addEventListener("scroll", () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(showPosition); }, { passive: true });
    width = Math.max(0, ...sections.map(page => page.offsetWidth));
    status.zoom.fit();
    showPosition();
    let resize = 0;
    window.addEventListener("resize", () => { cancelAnimationFrame(resize); resize = requestAnimationFrame(() => status.zoom.refit()); });
  },
};
export default viewer;

/** Heading paragraphs in document order, for the navigation pane. */
export function outline(pages: HTMLElement, levels: Map<string, number>): { element: HTMLElement; level: number; text: string }[] {
  if (!levels.size) return [];
  const byClass = new Map([...levels].map(([id, level]) => [styleClass(id), level]));
  const out: { element: HTMLElement; level: number; text: string }[] = [];
  for (const p of pages.querySelectorAll<HTMLElement>("section.docx p")) {
    if (p.closest("header, footer")) continue;
    const level = [...p.classList].map(c => byClass.get(c)).find(l => l !== undefined);
    const text = (p.textContent ?? "").replace(/\s+/g, " ").trim();
    if (level && text) out.push({ element: p, level, text });
  }
  return out;
}
