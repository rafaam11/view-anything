// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ disk: new Uint8Array(), writes: 0 }));
vi.mock("../src/platform", () => ({ platform: {
  fileSize: async () => state.disk.length,
  readFileRaw: async () => state.disk.slice().buffer,
  writeFileChecked: async (_path: string, expected: Uint8Array, bytes: Uint8Array) => { if (String(state.disk) !== String(expected)) return false; state.disk = bytes.slice(); state.writes++; return true; },
  setWindowTitle: async () => {}, onCloseRequested: async () => {},
  confirmDiscard: async () => false, alert: async () => {},
} }));
vi.mock("../src/update/guard", () => ({ registerUpdateGuard: () => {} }));
import viewer from "../src/data/structured-viewer";
const encode = (s: string) => new TextEncoder().encode(s);
const controls = (root: HTMLElement) => ["편집", "저장"].map(label => [...root.querySelectorAll("button")].find(b => b.textContent === label)!);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

test("JSON tree treats content as text and refuses to save invalid edits", async () => {
  state.disk = encode('{"key":"<img src=x>"}'); state.writes = 0;
  const root = document.createElement("div"); await viewer.mount(root, "data.json");
  expect(root.querySelector(".data-tree")?.textContent).toContain("<img src=x>");
  expect(root.querySelector("img")).toBeNull();
  const buttons = controls(root); buttons[0].click(); await settle();
  const input = root.querySelector("textarea")!;
  input.value = "{"; input.dispatchEvent(new Event("input")); buttons[1].click(); await settle();
  expect(state.writes).toBe(0); expect(root.textContent).toContain("구문 오류");
  input.value = '{"key": 2}\r\n'; input.dispatchEvent(new Event("input")); buttons[1].click(); await settle();
  expect(state.disk).toEqual(encode('{"key": 2}\n'));
});

test("YAML comments remain in the source when edited", async () => {
  state.disk = encode("# comment\r\na: 1\r\n"); state.writes = 0;
  const root = document.createElement("div"); await viewer.mount(root, "a.yaml");
  expect(root.textContent).toContain("a: 1");
  const buttons = controls(root); buttons[0].click(); await settle();
  const input = root.querySelector("textarea")!;
  input.value = "# comment\r\na: 2\r\n"; input.dispatchEvent(new Event("input")); buttons[1].click(); await settle();
  expect(state.disk).toEqual(encode("# comment\r\na: 2\r\n"));
});
