// @vitest-environment happy-dom
import JSZip from "jszip";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  bytes: new Uint8Array(), size: -1, opened: [] as string[], options: null as Record<string, unknown> | null,
  slides: 3, fail: null as Error | null, shown: [] as number[], zooms: [] as number[], destroyed: 0,
}));
vi.mock("../src/platform", () => ({ platform: {
  fileSize: async () => state.size >= 0 ? state.size : state.bytes.length,
  readFileRaw: async () => state.bytes.slice().buffer,
  openExternal: async (url: string) => { state.opened.push(url); },
  alert: async () => {},
} }));
vi.mock("@aiden0z/pptx-renderer", () => ({
  RECOMMENDED_ZIP_LIMITS: { maxEntries: 4000 },
  PptxViewer: {
    open: async (_input: unknown, container: HTMLElement, options: Record<string, unknown>) => {
      state.options = options;
      if (state.fail) throw state.fail;
      // Viewers mounted by earlier tests keep their window listeners: each deck records into its own arrays.
      const shown: number[] = [], zooms: number[] = [];
      state.shown = shown; state.zooms = zooms;
      container.innerHTML = '<a id="link" href="https://example.com/">link</a><a id="js" href="javascript:alert(1)">js</a>';
      return {
        slideCount: state.slides, slideWidth: 960, slideHeight: 540,
        goToSlide: async (i: number) => { shown.push(i); },
        setZoom: async (p: number) => { zooms.push(p); },
        destroy: () => { state.destroyed++; },
      };
    },
  },
}));
import viewer from "../src/office/pptx-viewer";

async function zip() {
  const z = new JSZip(); z.file("ppt/presentation.xml", "<p:presentation/>");
  return z.generateAsync({ type: "uint8array" });
}
async function mount() {
  state.bytes = await zip();
  const root = document.createElement("div"); document.body.append(root);
  await viewer.mount(root, "deck.pptx");
  return root;
}
const settle = () => new Promise(r => setTimeout(r, 0));
beforeEach(() => {
  Object.assign(state, { size: -1, opened: [], slides: 3, fail: null, shown: [], zooms: [], destroyed: 0 });
  document.body.replaceChildren();
});

test("size, encryption and renderer failures are reported; an empty deck is refused", async () => {
  state.size = 101 * 1024 * 1024;
  await expect(viewer.mount(document.createElement("div"), "big.pptx")).rejects.toThrow(/100 MiB/);
  state.size = -1; state.bytes = new Uint8Array(64); state.bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await expect(viewer.mount(document.createElement("div"), "old.ppt.pptx")).rejects.toThrow(/암호로 보호되었거나 이전 형식/);
  state.bytes = await zip(); state.fail = new Error("ZIP entry limit exceeded");
  await expect(viewer.mount(document.createElement("div"), "bad.pptx")).rejects.toThrow(/PowerPoint 파일을 읽을 수 없습니다: ZIP entry limit/);
  state.fail = null; state.slides = 0;
  await expect(viewer.mount(document.createElement("div"), "empty.pptx")).rejects.toThrow(/슬라이드가 없는/);
  expect(state.destroyed).toBe(1);
});

test("the renderer runs locked down: zip limits, no external media, no PDF.js", async () => {
  await mount();
  expect(state.options).toMatchObject({ renderMode: "slide", zipLimits: { maxEntries: 4000 }, externalMedia: "block", pdfjs: false });
});

test("buttons, the slide number and keys move between slides within the deck", async () => {
  const root = await mount();
  const [prev, next] = ["이전 슬라이드", "다음 슬라이드"].map(l => root.querySelector<HTMLButtonElement>(`[aria-label="${l}"]`)!);
  const input = root.querySelector<HTMLInputElement>('input[aria-label="슬라이드"]')!;
  await settle();
  expect(state.shown).toEqual([]); expect(prev.disabled).toBe(true); expect(input.value).toBe("1");
  next.click();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })); // already last: stays
  await settle();
  // Requests overtaken before their turn are skipped, as is the slide already shown.
  expect(state.shown).toEqual([2]); expect(next.disabled).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
  input.value = "2"; input.dispatchEvent(new Event("change"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", shiftKey: true }));
  await settle();
  expect(state.shown).toEqual([2, 0]);
  expect(root.querySelector("[role=status]")!.textContent).toBe("읽기 전용");
});

test("zoom goes to the renderer as a percentage; links follow the shared rules", async () => {
  const root = await mount();
  root.querySelector<HTMLButtonElement>('[aria-label="확대"]')!.click();
  await settle();
  expect(state.zooms.at(-1)).toBe(Math.round(state.zooms[0] * 1.25));
  root.querySelector("#link")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  root.querySelector("#js")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await settle();
  expect(state.opened).toEqual(["https://example.com/"]);
});
