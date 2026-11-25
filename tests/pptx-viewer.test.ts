// @vitest-environment happy-dom
import JSZip from "jszip";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  bytes: new Uint8Array(), size: -1, opened: [] as string[], options: null as Record<string, unknown> | null,
  slides: 3, fail: null as Error | null, shown: [] as number[], zooms: [] as number[], thumbs: [] as number[], destroyed: 0,
  fullscreen: [] as boolean[],
}));
vi.mock("../src/platform", () => ({ platform: {
  fileSize: async () => state.size >= 0 ? state.size : state.bytes.length,
  readFileRaw: async () => state.bytes.slice().buffer,
  openExternal: async (url: string) => { state.opened.push(url); },
  setFullscreen: async (on: boolean) => { state.fullscreen.push(on); },
  alert: async () => {},
} }));
vi.mock("@aiden0z/pptx-renderer", () => ({
  RECOMMENDED_ZIP_LIMITS: { maxEntries: 4000 },
  PptxViewer: {
    open: async (_input: unknown, container: HTMLElement, options: Record<string, unknown>) => {
      state.options = options;
      if (state.fail) throw state.fail;
      // Viewers mounted by earlier tests keep their window listeners: each deck records into its own arrays.
      const shown: number[] = [], zooms: number[] = [], thumbs: number[] = [];
      state.shown = shown; state.zooms = zooms; state.thumbs = thumbs;
      container.innerHTML = '<a id="link" href="https://example.com/">link</a><a id="js" href="javascript:alert(1)">js</a>';
      return {
        slideCount: state.slides, slideWidth: 960, slideHeight: 540,
        goToSlide: async (i: number) => { shown.push(i); },
        setZoom: async (p: number) => { zooms.push(p); },
        renderThumbnailToContainer: (i: number) => { thumbs.push(i); return { dispose() {} }; },
        destroy: () => { state.destroyed++; },
      };
    },
  },
}));
import viewer from "../src/office/pptx-viewer";

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (items: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;

/**
 * Three slides listed out of file order; slide 2 has notes, slide 3 an empty notes page. `r:id` comes
 * before `id`: happy-dom drops a namespaced attribute whose local name an earlier one already has.
 */
async function deck() {
  const z = new JSZip();
  z.file("_rels/.rels", rels(`<Relationship Id="r1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>`));
  z.file("ppt/presentation.xml", `<p:presentation ${P}><p:sldIdLst><p:sldId r:id="s3" id="256"/><p:sldId r:id="s1" id="257"/><p:sldId r:id="s2" id="258"/></p:sldIdLst></p:presentation>`);
  z.file("ppt/_rels/presentation.xml.rels", rels(["s1", "s2", "s3"].map(id => `<Relationship Id="${id}" Type="${REL}/slide" Target="slides/slide${id.slice(1)}.xml"/>`).join("")));
  for (const n of [1, 2, 3]) z.file(`ppt/slides/slide${n}.xml`, `<p:sld ${P}/>`);
  z.file("ppt/slides/_rels/slide1.xml.rels", rels(`<Relationship Id="n" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>`));
  z.file("ppt/slides/_rels/slide2.xml.rels", rels(`<Relationship Id="n" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide2.xml"/>`));
  const notes = (body: string) => `<p:notes ${P}><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld></p:notes>`;
  z.file("ppt/notesSlides/notesSlide1.xml", notes("<a:p><a:r><a:t>첫 줄 </a:t></a:r><a:r><a:t>이어짐</a:t></a:r></a:p><a:p><a:r><a:t>둘째 줄</a:t></a:r></a:p>"));
  z.file("ppt/notesSlides/notesSlide2.xml", notes("<a:p/>"));
  return z.generateAsync({ type: "uint8array" });
}
async function mount() {
  state.bytes = await deck();
  const root = document.createElement("div"); document.body.append(root);
  await viewer.mount(root, "deck.pptx");
  return root;
}
const settle = () => new Promise(r => setTimeout(r, 0));
const press = (key: string, init: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...init }));
const info = (root: HTMLElement) => root.querySelector(".office-status-info")!.textContent;
beforeEach(() => {
  Object.assign(state, { size: -1, opened: [], slides: 3, fail: null, destroyed: 0, fullscreen: [] });
  delete document.documentElement.dataset.fullscreen;
  document.body.replaceChildren();
});

test("size, encryption and renderer failures are reported; an empty deck is refused", async () => {
  state.size = 101 * 1024 * 1024;
  await expect(viewer.mount(document.createElement("div"), "big.pptx")).rejects.toThrow(/100 MiB/);
  state.size = -1; state.bytes = new Uint8Array(64); state.bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await expect(viewer.mount(document.createElement("div"), "old.pptx")).rejects.toThrow(/암호로 보호되었거나 이전 형식/);
  state.bytes = await deck(); state.fail = new Error("ZIP entry limit exceeded");
  await expect(viewer.mount(document.createElement("div"), "bad.pptx")).rejects.toThrow(/PowerPoint 파일을 읽을 수 없습니다: ZIP entry limit/);
  state.fail = null; state.slides = 0;
  await expect(viewer.mount(document.createElement("div"), "empty.pptx")).rejects.toThrow(/슬라이드가 없는/);
  expect(state.destroyed).toBe(1);
});

// First to mount: viewers of later tests would also take F5 (their window listeners stay).
test("F5 shows the deck full screen from the start; clicks advance, Esc or the end leaves", async () => {
  const root = await mount();
  root.querySelectorAll<HTMLButtonElement>(".pptx-thumb")[2].click();
  press("F5");
  await settle();
  expect(root.querySelector<HTMLElement>(".pptx-root")!.dataset.show).toBe("true");
  expect(state.fullscreen).toEqual([true]);
  expect(info(root)).toBe("슬라이드 1/3   읽기 전용");
  const stage = root.querySelector<HTMLElement>(".pptx-stage")!;
  stage.click(); stage.click();
  expect(info(root)).toBe("슬라이드 3/3   읽기 전용");
  stage.click(); // past the last slide
  await settle();
  expect(root.querySelector<HTMLElement>(".pptx-root")!.dataset.show).toBeUndefined();
  expect(state.fullscreen).toEqual([true, false]);
  press("F5", { shiftKey: true }); // from the current slide
  await settle();
  expect(info(root)).toBe("슬라이드 3/3   읽기 전용");
  press("Escape");
  await settle();
  expect(root.querySelector<HTMLElement>(".pptx-root")!.dataset.show).toBeUndefined();
});

test("the renderer runs locked down: zip limits, no external media, no PDF.js", async () => {
  await mount();
  expect(state.options).toMatchObject({ renderMode: "slide", zipLimits: { maxEntries: 4000 }, externalMedia: "block", pdfjs: false });
});

test("the rail lists every slide; thumbnails, keys and the wheel move through the deck with its notes", async () => {
  const root = await mount();
  const thumbs = [...root.querySelectorAll<HTMLButtonElement>(".pptx-thumb")];
  expect(thumbs.map(t => t.getAttribute("aria-label"))).toEqual(["슬라이드 1", "슬라이드 2", "슬라이드 3"]);
  expect(thumbs[0].getAttribute("aria-current")).toBe("true");
  const notes = root.querySelector<HTMLElement>(".pptx-notes")!;
  // presentation order (s3, s1, s2): slide 1 is file slide3 without notes.
  expect(notes.textContent).toBe("노트 없음");
  expect(info(root)).toBe("슬라이드 1/3   읽기 전용");
  thumbs[1].click();
  await settle();
  expect(notes.textContent).toBe("첫 줄 이어짐\n둘째 줄");
  expect(info(root)).toBe("슬라이드 2/3   읽기 전용");
  press("PageDown"); press("ArrowRight"); // the second is past the end: stays on the last slide
  await settle();
  expect(notes.textContent).toBe("노트 없음"); // an empty notes page
  expect(state.shown).toEqual([1, 2]);
  press("Home");
  const stage = root.querySelector<HTMLElement>(".pptx-stage")!;
  stage.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
  stage.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true })); // within 250 ms: ignored
  await settle();
  expect(info(root)).toBe("슬라이드 2/3   읽기 전용");
});

test("zoom goes to the renderer as a percentage; links follow the shared rules; thumbnails render once", async () => {
  const root = await mount();
  root.querySelector<HTMLButtonElement>('[aria-label="확대"]')!.click();
  await settle();
  expect(state.zooms.at(-1)).toBe(Math.round(state.zooms.at(-2)! * 1.25));
  root.querySelector("#link")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  root.querySelector("#js")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await settle();
  expect(state.opened).toEqual(["https://example.com/"]);
  expect(new Set(state.thumbs).size).toBe(state.thumbs.length);
});
