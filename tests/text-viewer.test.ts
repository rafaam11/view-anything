// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
let disk = new Uint8Array(), close: () => Promise<boolean>;
const { platform } = vi.hoisted(() => ({ platform: {
  fileSize: vi.fn(async () => disk.length), readFileRaw: vi.fn(async () => disk.slice().buffer),
  writeFileChecked: vi.fn(async (_path: string, _expected: Uint8Array, bytes: Uint8Array) => { disk = bytes.slice(); return true; }),
  setWindowTitle: vi.fn(async () => {}), confirmDiscard: vi.fn(async () => false),
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
  vi.clearAllMocks(); disk = new TextEncoder().encode("한글\r\nline\r\n");
  document.body.replaceChildren();
  await viewer.mount(document.body, "test.txt");
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
  expect(await close()).toBe(true); expect(status()).toBe("저장됨");
});
test("external write is not replaced and recovery copy retains edits", async () => {
  button("편집").click(); await settle(); edit("mine\n"); disk = new TextEncoder().encode("external");
  button("저장").click(); await settle();
  expect(platform.writeFileChecked).not.toHaveBeenCalled();
  expect(status()).toContain("외부"); expect(source().value).toBe("mine\n");
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
