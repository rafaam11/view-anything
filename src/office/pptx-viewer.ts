import "./office.css";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";
import { platform } from "../platform";
import type { Viewer } from "../registry";
import { documentBar } from "../ui/chrome";
import { iconButton } from "../ui/icons";
import { errorMessage } from "../ui/strings";
import { followLink } from "./links";
import { checkOfficePackage } from "./zip-guard";
import { zoomControls } from "./zoom";

const MAX_BYTES = 100 * 1024 * 1024;
const MARGIN = 24;

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error("PowerPoint 파일이 100 MiB를 초과합니다.");
    const bytes = new Uint8Array(await platform.readFileRaw(path));
    checkOfficePackage(bytes, "PowerPoint");
    const root = document.createElement("div"); root.className = "office-root pptx-root va-viewer";
    const bar = document.createElement("header");
    const status = document.createElement("span"); status.setAttribute("role", "status"); status.className = "va-status";
    const stage = document.createElement("div"); stage.className = "pptx-stage"; stage.tabIndex = 0; stage.setAttribute("aria-label", "슬라이드");
    const slide = document.createElement("div"); slide.className = "pptx-slide";
    stage.append(slide);
    // Attached before rendering: the renderer measures its container.
    root.append(bar, stage, status); el.replaceChildren(root);
    let deck: PptxViewer;
    try {
      deck = await PptxViewer.open(bytes, slide, {
        renderMode: "slide", fitMode: "none", zoomPercent: 100,
        zipLimits: RECOMMENDED_ZIP_LIMITS, lazySlides: true, lazyMedia: true,
        // A local viewer never fetches: linked pictures and media stay blank. No PDF.js for EMF previews.
        externalMedia: "block", pdfjs: false,
      });
    } catch (e) {
      el.replaceChildren();
      throw new Error(`PowerPoint 파일을 읽을 수 없습니다: ${errorMessage(e)}`);
    }
    const count = deck.slideCount;
    if (!count) { deck.destroy(); el.replaceChildren(); throw new Error("슬라이드가 없는 프레젠테이션입니다."); }
    const prev = iconButton("이전 슬라이드", "previous", "PgUp"), next = iconButton("다음 슬라이드", "next", "PgDn");
    const input = document.createElement("input"); input.type = "number"; input.min = "1"; input.max = String(count); input.setAttribute("aria-label", "슬라이드");
    const total = document.createElement("span"); total.textContent = `/ ${count}`;
    const report = (e: unknown) => { status.textContent = `슬라이드 표시 오류: ${errorMessage(e)}`; };
    // open() in slide mode has already drawn the first slide.
    let index = 0, drawn = 0, rendering: Promise<void> = Promise.resolve();
    const zoom = zoomControls(stage, scale => { rendering = rendering.then(() => deck.setZoom(Math.round(scale * 100))).catch(report); }, () => {
      const w = deck.slideWidth, h = deck.slideHeight;
      return w && h ? Math.max(0.1, Math.min((stage.clientWidth - MARGIN * 2) / w, (stage.clientHeight - MARGIN * 2) / h)) : null;
    });
    documentBar(bar, { controls: [prev, input, total, next, ...zoom.controls] });
    const show = (target: number) => {
      target = Math.max(0, Math.min(count - 1, target));
      index = target; input.value = String(index + 1);
      prev.disabled = index === 0; next.disabled = index === count - 1;
      status.textContent = "읽기 전용";
      // Renders run one at a time; a request overtaken by a newer one, or for the slide already shown, is skipped.
      rendering = rendering.then(() => {
        if (target !== index || target === drawn) return;
        drawn = target;
        return deck.goToSlide(target);
      }).catch(report);
    };
    prev.onclick = () => show(index - 1);
    next.onclick = () => show(index + 1);
    input.onchange = () => { const n = Number(input.value); if (Number.isInteger(n)) show(n - 1); else input.value = String(index + 1); };
    stage.addEventListener("click", e => followLink(e, slide));
    window.addEventListener("keydown", e => {
      if (document.querySelector("dialog[open]") || e.ctrlKey || e.altKey || e.metaKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=true]")) return;
      const step: Record<string, number> = { PageDown: 1, ArrowRight: 1, ArrowDown: 1, " ": 1, PageUp: -1, ArrowLeft: -1, ArrowUp: -1 };
      if (e.key in step) { e.preventDefault(); show(index + (e.shiftKey && e.key === " " ? -1 : step[e.key])); }
      else if (e.key === "Home") { e.preventDefault(); show(0); }
      else if (e.key === "End") { e.preventDefault(); show(count - 1); }
    });
    window.addEventListener("unload", () => deck.destroy());
    show(0);
    zoom.fit();
    let frame = 0;
    window.addEventListener("resize", () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => zoom.refit()); });
  },
};
export default viewer;
