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
  expect(root.querySelector(".office-status-info")!.textContent).toBe("1페이지 중 1페이지   단어 1개   읽기 전용");
  expect(root.querySelector<HTMLElement>(".docx-nav")!.hidden).toBe(true); // no headings: the pane stays shut
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

test("headings fill the navigation pane in document order and take the reader there; Ctrl+F finds", async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const z = new JSZip();
  z.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`);
  z.file("word/document.xml", `<w:document ${W}/>`);
  // Korean Word names heading styles "1", "2" by id; their style names stay "heading N". "Sub" inherits an outline level.
  z.file("word/styles.xml", `<w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style>
    <w:style w:type="paragraph" w:styleId="Outline"><w:name w:val="My Outline"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Sub"><w:name w:val="Sub"/><w:basedOn w:val="Outline"/></w:style>
    <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="character" w:styleId="2"><w:name w:val="heading 2"/></w:style>
  </w:styles>`);
  state.bytes = await z.generateAsync({ type: "uint8array" });
  state.html = '<article><p class="docx_1">서론</p><p class="docx_normal">본문 needle</p><p class="docx_sub">세부 항목</p><p class="docx_1"> </p></article>';
  const root = document.createElement("div"); document.body.append(root);
  await viewer.mount(root, "headings.docx");
  const nav = root.querySelector<HTMLElement>(".docx-nav")!;
  expect(nav.hidden).toBe(false);
  const items = [...nav.querySelectorAll<HTMLButtonElement>(".docx-nav-item")];
  expect(items.map(b => [b.textContent, b.style.paddingInlineStart])).toEqual([["서론", "8px"], ["세부 항목", "22px"]]);
  const target = root.querySelector<HTMLElement>(".docx_sub")!;
  target.scrollIntoView = vi.fn();
  items[1].click();
  expect(target.scrollIntoView).toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }));
  const find = root.querySelector<HTMLElement>(".va-find")!;
  expect(find.hidden).toBe(false);
  const input = find.querySelector("input")!;
  input.value = "needle"; input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(root.querySelectorAll(".docx-pages mark")).toHaveLength(1));
});
