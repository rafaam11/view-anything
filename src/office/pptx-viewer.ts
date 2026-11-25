import "./office.css";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";
import { isFullscreen, toggleFullscreen } from "../fullscreen";
import { platform } from "../platform";
import type { Viewer } from "../registry";
import { documentBar } from "../ui/chrome";
import { textButton } from "../ui/icons";
import { errorMessage } from "../ui/strings";
import { followLink } from "./links";
import { readNotes } from "./pptx-notes";
import { checkOfficePackage } from "./zip-guard";
import { officeStatusBar } from "./zoom";

const MAX_BYTES = 100 * 1024 * 1024;
const MARGIN = 24;
const THUMB_WIDTH = 160;

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("PowerPoint 파일이 100 MiB를 초과합니다.");
    const bytes = new Uint8Array(await platform.readFileRaw(path));
    checkOfficePackage(bytes, "PowerPoint");
    const root = document.createElement("div"); root.className = "office-root pptx-root va-viewer"; root.dataset.office = "powerpoint";
    const bar = document.createElement("header");
    const body = document.createElement("div"); body.className = "office-body";
    const rail = document.createElement("nav"); rail.className = "office-pane pptx-rail"; rail.setAttribute("aria-label", "슬라이드 목록");
    const main = document.createElement("div"); main.className = "pptx-main";
    const stage = document.createElement("div"); stage.className = "pptx-stage"; stage.tabIndex = 0; stage.setAttribute("aria-label", "슬라이드");
    const slide = document.createElement("div"); slide.className = "pptx-slide";
    const notes = document.createElement("div"); notes.className = "pptx-notes"; notes.setAttribute("aria-label", "슬라이드 노트");
    stage.append(slide); main.append(stage, notes); body.append(rail, main);
    // Attached before rendering: the renderer measures its container.
    root.append(bar, body); el.replaceChildren(root);
    let deck: PptxViewer;
    let notesText: string[] = [];
    try {
      [deck, notesText] = await Promise.all([
        PptxViewer.open(bytes, slide, {
          renderMode: "slide", fitMode: "none", zoomPercent: 100,
          zipLimits: RECOMMENDED_ZIP_LIMITS, lazySlides: true, lazyMedia: true,
          // A local viewer never fetches: linked pictures and media stay blank. No PDF.js for EMF previews.
          externalMedia: "block", pdfjs: false,
        }),
        readNotes(bytes).catch(() => [] as string[]),
      ]);
    } catch (e) {
      el.replaceChildren();
      throw new Error(`PowerPoint 파일을 읽을 수 없습니다: ${errorMessage(e)}`);
    }
    const count = deck.slideCount;
    if (!count) { deck.destroy(); el.replaceChildren(); throw new Error("슬라이드가 없는 프레젠테이션입니다."); }
    const report = (e: unknown) => { status.info([`슬라이드 표시 오류: ${errorMessage(e)}`]); };
    // open() in slide mode has already drawn the first slide.
    let index = 0, drawn = 0, rendering: Promise<void> = Promise.resolve(), showing = false, enteredFullscreen = false;
    const status = officeStatusBar(stage, scale => { rendering = rendering.then(() => deck.setZoom(Math.round(scale * 100))).catch(report); }, () => {
      const w = deck.slideWidth, h = deck.slideHeight, margin = showing ? 0 : MARGIN;
      return w && h ? Math.max(0.1, Math.min((stage.clientWidth - margin * 2) / w, (stage.clientHeight - margin * 2) / h)) : null;
    });
    root.append(status.element);
    const showButton = textButton("슬라이드 쇼", "secondary", { shortcut: "F5" });
    documentBar(bar, {
      controls: [showButton],
      view: [
        { label: "처음부터 슬라이드 쇼", shortcut: "F5", run: () => void startShow(0) },
        { label: "현재 슬라이드부터 슬라이드 쇼", shortcut: "Shift+F5", run: () => void startShow(index) },
        { label: "슬라이드 목록", checked: () => !rail.hidden, run: () => { rail.hidden = !rail.hidden; refit(); } },
        { label: "노트", checked: () => !notes.hidden, run: () => { notes.hidden = !notes.hidden; refit(); } },
      ],
    });
    showButton.onclick = () => void startShow(0);

    // Thumbnails render when they scroll into the rail, so a long deck opens as fast as a short one.
    const thumbs: HTMLButtonElement[] = [];
    const rendered = new Set<number>();
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const i = Number((entry.target as HTMLElement).dataset.index);
        if (rendered.has(i)) continue;
        rendered.add(i);
        const box = entry.target.querySelector<HTMLElement>(".pptx-thumb-box");
        if (box) { try { deck.renderThumbnailToContainer(i, box, { width: THUMB_WIDTH }); } catch { /* an unreadable slide keeps a blank thumbnail */ } }
      }
    }, { root: rail, rootMargin: "200px" }) : null;
    for (let i = 0; i < count; i++) {
      const b = textButton("", "ghost"); b.classList.add("pptx-thumb"); b.dataset.index = String(i);
      b.setAttribute("aria-label", `슬라이드 ${i + 1}`);
      const number = document.createElement("span"); number.className = "pptx-thumb-number"; number.textContent = String(i + 1);
      const box = document.createElement("span"); box.className = "pptx-thumb-box";
      if (deck.slideWidth && deck.slideHeight) box.style.aspectRatio = `${deck.slideWidth} / ${deck.slideHeight}`;
      b.replaceChildren(number, box);
      b.onclick = () => show(i);
      rail.append(b); thumbs.push(b); observer?.observe(b);
    }

    const show = (target: number) => {
      target = Math.max(0, Math.min(count - 1, target));
      index = target;
      thumbs.forEach((b, i) => b.setAttribute("aria-current", i === index ? "true" : "false"));
      thumbs[index].scrollIntoView?.({ block: "nearest" });
      const text = notesText[index] ?? "";
      notes.textContent = text;
      notes.classList.toggle("pptx-notes-empty", !text);
      if (!text) notes.textContent = "노트 없음";
      status.info([`슬라이드 ${index + 1}/${count}`, "읽기 전용"]);
      // Renders run one at a time; a request overtaken by a newer one, or for the slide already shown, is skipped.
      rendering = rendering.then(() => {
        if (target !== index || target === drawn) return;
        drawn = target;
        return deck.goToSlide(target);
      }).catch(report);
    };
    const refit = () => requestAnimationFrame(() => status.zoom.refit());

    /** PowerPoint's slide show: the slide alone on black, full screen; Esc or the end of the deck leaves. */
    const startShow = async (from: number) => {
      if (showing) return;
      showing = true; root.dataset.show = "true";
      show(from);
      if (!isFullscreen()) { enteredFullscreen = true; await toggleFullscreen().catch(() => { enteredFullscreen = false; }); }
      status.zoom.fit(); stage.focus({ preventScroll: true });
    };
    const endShow = async () => {
      if (!showing) return;
      showing = false; delete root.dataset.show;
      if (enteredFullscreen && isFullscreen()) await toggleFullscreen().catch(() => {});
      enteredFullscreen = false;
      status.zoom.fit();
    };
    const advance = (delta: number) => {
      if (showing && index + delta >= count) { void endShow(); return; }
      show(index + delta);
    };

    stage.addEventListener("click", e => {
      followLink(e, slide);
      if (showing && !e.defaultPrevented) advance(1);
    });
    // The wheel turns slides while the slide fits, as in PowerPoint; zoomed in, it scrolls.
    let wheelAt = 0;
    stage.addEventListener("wheel", e => {
      if (e.ctrlKey || !e.deltaY) return;
      const overflows = stage.scrollHeight > stage.clientHeight + 1;
      if (overflows && !showing) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 250) return;
      wheelAt = now; advance(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    window.addEventListener("keydown", e => {
      if (document.querySelector("dialog[open]") || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "F5") { e.preventDefault(); if (!e.repeat) void startShow(e.shiftKey ? index : 0); return; }
      if (e.key === "Escape" && showing) { e.preventDefault(); e.stopPropagation(); void endShow(); return; }
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=true], [role=menu], [role=menubar]")) return;
      const step: Record<string, number> = { PageDown: 1, ArrowRight: 1, ArrowDown: 1, " ": 1, Enter: 1, n: 1, PageUp: -1, ArrowLeft: -1, ArrowUp: -1, Backspace: -1, p: -1 };
      // Space and Enter press a focused button instead (the rail's thumbnails) outside the show.
      if ((e.key === " " || e.key === "Enter") && !showing && (e.target as HTMLElement | null)?.closest?.("button")) return;
      if (e.key in step) { e.preventDefault(); advance(e.shiftKey && e.key === " " ? -1 : step[e.key]); }
      else if (e.key === "Home") { e.preventDefault(); show(0); }
      else if (e.key === "End") { e.preventDefault(); show(count - 1); }
    }, true);
    window.addEventListener("unload", () => { observer?.disconnect(); deck.destroy(); });
    show(0);
    status.zoom.fit();
    let frame = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Leaving full screen another way (F11) also ends a show that entered it.
        if (showing && enteredFullscreen && !isFullscreen()) { enteredFullscreen = false; void endShow(); return; }
        status.zoom.refit();
      });
    });
  },
};
export default viewer;
