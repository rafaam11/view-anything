// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyPreferences, DEFAULTS } from "../src/settings/preferences";
let disk = new Uint8Array(), close: () => Promise<boolean>;
const { platform } = vi.hoisted(() => ({ platform: {
  fileSize: vi.fn(async () => disk.length), readFileRaw: vi.fn(async () => disk.slice().buffer),
  writeFileChecked: vi.fn(async (_path: string, _expected: Uint8Array, bytes: Uint8Array) => { disk = bytes.slice(); return true; }),
  setWindowTitle: vi.fn(async () => {}), confirmDiscard: vi.fn(async () => false), notice: vi.fn(async () => {}),
  onCloseRequested: vi.fn(async (fn: () => Promise<boolean>) => { close = fn; }),
  saveDialog: vi.fn(async () => "copy.txt"), writeFileNew: vi.fn(async () => {}),
} }));
vi.mock("../src/platform", () => ({ platform }));
vi.mock("../src/update/guard", () => ({ registerUpdateGuard: vi.fn() }));
import viewer from "../src/text/viewer";
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const button = (text: string) => [...document.querySelectorAll("button")].find(b => (b.querySelector(".va3d-menu-label")?.textContent ?? b.textContent) === text)!;
const source = () => document.querySelector("textarea")!;
const edit = (text: string) => { source().value = text; source().dispatchEvent(new Event("input")); };
const status = () => document.querySelector('[role="status"]')!.textContent;
beforeEach(async () => {
  vi.clearAllMocks(); vi.spyOn(window,"addEventListener"); applyPreferences(DEFAULTS,false); disk = new TextEncoder().encode("한글\r\nline\r\n");
  document.body.replaceChildren();
  await viewer.mount(document.body, "test.txt");
});
afterEach(()=>{
  for(const [type,listener,options] of vi.mocked(window.addEventListener).mock.calls)window.removeEventListener(type,listener,options);
  vi.restoreAllMocks();
});
test("display options preserve source bytes, selection, read mode and unsaved edits",async()=>{
  const original=disk.slice(),text=source().value;expect(source().wrap).toBe("soft");
  source().setSelectionRange(1,3);applyPreferences({textFont:"serif",textSize:22,textWrap:false},false);
  expect(source().wrap).toBe("off");expect(source().readOnly).toBe(true);expect(source().value).toBe(text);expect(source().selectionStart).toBe(1);
  expect(disk).toEqual(original);expect(platform.writeFileChecked).not.toHaveBeenCalled();expect(await close()).toBe(true);
  button("편집").click();await settle();edit("mine\n");applyPreferences({textWrap:true,textSize:16},false);
  expect(source().wrap).toBe("soft");expect(source().value).toBe("mine\n");expect(await close()).toBe(false);
  button("저장").click();await settle();expect(new TextDecoder().decode(disk)).toBe("mine\r\n");
});
test("each discard prompt names what happens: close, reload", async () => {
  button("편집").click(); await settle(); edit("changed\n");
  expect(await close()).toBe(false);
  expect(platform.confirmDiscard).toHaveBeenLastCalledWith("저장하지 않은 변경 내용을 버리고 닫을까요?", "닫기");
  button("다시 읽기").click(); await settle();
  expect(platform.confirmDiscard).toHaveBeenLastCalledWith("저장하지 않은 변경 내용을 버리고 파일을 다시 읽을까요?", "다시 읽기");
  expect(source().value).toBe("changed\n");
});
test("read mode is immutable and cancelling a dirty close keeps edits", async () => {
  expect(source().readOnly).toBe(true);
  expect(document.querySelector("select")).toBeNull();
  expect(document.querySelector<HTMLElement>(".text-search")!.hidden).toBe(true);
  expect(status()).toBe("");
  button("편집").click(); await settle(); edit("changed\n");
  expect(await close()).toBe(false); expect(source().value).toBe("changed\n");
});
test("safe save preserves CRLF and clears dirty state", async () => {
  button("편집").click(); await settle(); edit("changed\n");
  button("저장").click(); await settle();
  expect(new TextDecoder().decode(disk)).toBe("changed\r\n");
  expect(await close()).toBe(true); expect(status()).toBe(""); expect(document.querySelector(".va-toast:not([hidden])")?.textContent).toBe("저장했습니다");
});
test("external write is not replaced and recovery copy retains edits", async () => {
  button("편집").click(); await settle(); edit("mine\n"); disk = new TextEncoder().encode("external");
  button("저장").click(); await settle();
  expect(platform.writeFileChecked).not.toHaveBeenCalled();
  expect(platform.notice).toHaveBeenCalledWith(expect.stringContaining("외부에서 바뀌었거나"), "warning"); expect(source().value).toBe("mine\n");
  button("다른 이름으로 저장").click(); await settle();
  expect(platform.writeFileNew).toHaveBeenCalledWith("copy.txt", new TextEncoder().encode("mine\r\n"));
  expect(await close()).toBe(false);
});
test("write errors retain editor contents and permit retry", async () => {
  button("편집").click(); await settle(); edit("mine\n");
  platform.writeFileChecked.mockRejectedValueOnce(Error("disk full"));
  button("저장").click(); await settle(); expect(status()).toContain("disk full");
  expect(source().readOnly).toBe(false); expect(await close()).toBe(false);
  button("저장").click(); await settle(); expect(await close()).toBe(true);
});
test("mixed line endings and binary content are protected", async () => {
  disk = new TextEncoder().encode("a\r\nb\nc"); await viewer.mount(document.body, "mixed.txt");
  expect(button("편집").disabled).toBe(true); expect(status()).toContain("혼합");
  disk = new Uint8Array([0x41, 0]); await viewer.mount(document.body, "binary");
  expect(button("편집").disabled).toBe(true); expect(source().value).toBe("");
});
test("undecodable bytes point to the encoding setting, binary bytes do not", async () => {
  disk = new Uint8Array([0xc7, 0xd1]); document.body.replaceChildren(); await viewer.mount(document.body, "cp.txt");
  expect(status()).toContain("CP949");
  disk = new Uint8Array([0x41, 0, 0x42]); document.body.replaceChildren(); await viewer.mount(document.body, "bin.txt");
  expect(status()).toContain("바이너리"); expect(status()).not.toContain("CP949");
});
test("code files get a highlight layer that mirrors the source without changing it", async () => {
  disk = new TextEncoder().encode("def f():\n    return 1\n"); document.body.replaceChildren(); await viewer.mount(document.body, "code.py");
  const layer = document.querySelector<HTMLElement>(".text-highlight")!;
  await vi.waitFor(() => expect(layer.querySelector(".hljs-keyword")?.textContent).toBe("def"));
  expect(layer.textContent!.trimEnd()).toBe(source().value.trimEnd());
  expect(layer.getAttribute("aria-hidden")).toBe("true");
  expect(document.querySelector(".text-stack")!.getAttribute("data-highlight")).toBe("on");
  expect(disk).toEqual(new TextEncoder().encode("def f():\n    return 1\n"));
});
test("the highlight follows edits after a short pause and leaves plain text alone", async () => {
  disk = new TextEncoder().encode("x = 1\n"); document.body.replaceChildren(); await viewer.mount(document.body, "code.py");
  button("편집").click(); await settle();
  edit("import os\n");
  await vi.waitFor(() => expect(document.querySelector(".text-highlight")!.textContent).toContain("import os"));
  disk = new TextEncoder().encode("plain\n"); document.body.replaceChildren(); await viewer.mount(document.body, "notes.txt");
  expect(document.querySelector(".text-stack")!.getAttribute("data-highlight")).not.toBe("on");
});
test("turning highlighting off in settings drops the layer and keeps the text", async () => {
  disk = new TextEncoder().encode("def f(): pass\n"); document.body.replaceChildren(); await viewer.mount(document.body, "code.py");
  await vi.waitFor(() => expect(document.querySelector(".text-stack")!.getAttribute("data-highlight")).toBe("on"));
  applyPreferences({ textHighlight: false }, false);
  await vi.waitFor(() => expect(document.querySelector(".text-stack")!.getAttribute("data-highlight")).not.toBe("on"));
  expect(source().value).toBe("def f(): pass\n");
  applyPreferences({ textHighlight: true }, false);
  await vi.waitFor(() => expect(document.querySelector(".text-stack")!.getAttribute("data-highlight")).toBe("on"));
});
test("the layer scrolls and wraps with the source", async () => {
  disk = new TextEncoder().encode("x = 1\n".repeat(50)); document.body.replaceChildren(); await viewer.mount(document.body, "code.py");
  const stack = document.querySelector<HTMLElement>(".text-stack")!, layer = document.querySelector<HTMLElement>(".text-highlight")!;
  expect(stack.getAttribute("data-wrap")).toBe("soft");
  source().scrollTop = 40; source().scrollLeft = 7; source().dispatchEvent(new Event("scroll"));
  expect(layer.scrollTop).toBe(40); expect(layer.scrollLeft).toBe(7);
  applyPreferences({ textWrap: false }, false);
  expect(stack.getAttribute("data-wrap")).toBe("off");
});
test("typing keeps the mirrored box, so scrollbars and wrapping do not jump", async () => {
  disk = new TextEncoder().encode("x = 1\n"); document.body.replaceChildren(); await viewer.mount(document.body, "code.py");
  const stack = document.querySelector<HTMLElement>(".text-stack")!;
  await vi.waitFor(() => expect(stack.getAttribute("data-highlight")).toBe("on"));
  expect(stack.getAttribute("data-mirror")).toBe("on");
  button("편집").click(); await settle();
  edit("y = 2\n");
  expect(stack.getAttribute("data-highlight")).not.toBe("on");
  expect(stack.getAttribute("data-mirror")).toBe("on");
  document.body.replaceChildren(); disk = new TextEncoder().encode("plain\n"); await viewer.mount(document.body, "notes.txt");
  expect(document.querySelector(".text-stack")!.getAttribute("data-mirror")).not.toBe("on");
});
test("large edits stay plain while typing and get colours again after saving", async () => {
  disk = new TextEncoder().encode("x = 1\n"); document.body.replaceChildren(); await viewer.mount(document.body, "code.py");
  const stack = document.querySelector<HTMLElement>(".text-stack")!;
  button("편집").click(); await settle();
  edit(`s = "${"a".repeat(210_000)}"\n`); // over the live limit, few tokens (happy-dom parses spans slowly)
  await new Promise((r) => setTimeout(r, 400));
  expect(stack.getAttribute("data-highlight")).not.toBe("on");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
  await vi.waitFor(() => expect(stack.getAttribute("data-highlight")).toBe("on"), { timeout: 5000 });
});
