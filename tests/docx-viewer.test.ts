// @vitest-environment happy-dom
import JSZip from "jszip";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ bytes: new Uint8Array(), size: -1, opened: [] as string[], options: null as Record<string, unknown> | null, html: "" }));
vi.mock("../src/platform", () => ({ platform: {
  fileSize: async () => state.size >= 0 ? state.size : state.bytes.length,
  readFileRaw: async () => state.bytes.slice().buffer,
  openExternal: async (url: string) => { state.opened.push(url); },
  alert: async () => {},
} }));
vi.mock("docx-preview", () => ({
  renderAsync: async (_data: unknown, body: HTMLElement, _styles: HTMLElement, options: Record<string, unknown>) => {
    state.options = options;
    if (state.html === "throw") throw new Error("Can't find end of central directory");
    body.innerHTML = `<div class="docx-wrapper"><section class="docx">${state.html}</section></div>`;
  },
}));
import viewer from "../src/office/docx-viewer";

async function zip() {
  const z = new JSZip(); z.file("word/document.xml", "<w:document/>");
  return z.generateAsync({ type: "uint8array" });
}
beforeEach(() => { state.size = -1; state.opened = []; state.html = ""; document.body.replaceChildren(); });

test("files over 100 MiB, encrypted files and render failures are reported", async () => {
  state.size = 101 * 1024 * 1024;
  await expect(viewer.mount(document.createElement("div"), "big.docx")).rejects.toThrow(/100 MiB/);
  state.size = -1; state.bytes = new Uint8Array(64); state.bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await expect(viewer.mount(document.createElement("div"), "secret.docx")).rejects.toThrow(/암호로 보호/);
  state.bytes = await zip(); state.html = "throw";
  await expect(viewer.mount(document.createElement("div"), "broken.docx")).rejects.toThrow(/Word 파일을 읽을 수 없습니다: Can't find/);
});

test("the document renders read-only, without raw-HTML chunks, with data: resources", async () => {
  state.bytes = await zip(); state.html = "<p>본문</p>";
  const root = document.createElement("div"); document.body.append(root);
  await viewer.mount(root, "a.docx");
  expect(root.querySelector(".docx-pages section.docx")!.textContent).toBe("본문");
  expect(root.querySelector("[role=status]")!.textContent).toBe("읽기 전용");
  expect(state.options).toMatchObject({ renderAltChunks: false, useBase64URL: true, renderComments: false, renderChanges: false });
  expect(root.querySelector(".office-zoom")!.textContent).toBe("100%");
});

test("links: web and mail open outside, bookmarks scroll, anything else does nothing", async () => {
  state.bytes = await zip();
  state.html = '<a id="w" href="https://example.com/a b">web</a><a id="m" href="mailto:x@example.com">mail</a><a id="j" href="javascript:alert(1)">js</a>'
    + '<a id="f" href="file:///C:/Windows/notepad.exe">file</a><a id="b" href="#목차">bookmark</a><span id="목차">here</span>';
  const root = document.createElement("div"); document.body.append(root);
  await viewer.mount(root, "a.docx");
  const scrolled = vi.fn();
  (root.querySelector("#목차") as HTMLElement).scrollIntoView = scrolled;
  const click = (id: string) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    root.querySelector(`#${id}`)!.dispatchEvent(event);
    return event.defaultPrevented;
  };
  for (const id of ["w", "m", "j", "f", "b"]) expect(click(id), id).toBe(true);
  await vi.waitFor(() => expect(state.opened).toEqual(["https://example.com/a%20b", "mailto:x@example.com"]));
  expect(scrolled).toHaveBeenCalledOnce();
});
