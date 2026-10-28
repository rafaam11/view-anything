// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ disk: new Uint8Array(), close: async () => true, alerts: [] as string[] }));
vi.mock("../src/platform", () => ({ platform: {
  fileSize: async () => state.disk.length,
  readFileRaw: async () => state.disk.slice().buffer,
  writeFileRaw: async (_path: string, bytes: Uint8Array) => { state.disk = bytes.slice(); },
  setWindowTitle: async () => {},
  onCloseRequested: async (fn: () => Promise<boolean>) => { state.close = fn; },
  confirmDiscard: async () => false,
  alert: async (message: string) => { state.alerts.push(message); },
} }));
vi.mock("../src/update/guard", () => ({ registerUpdateGuard: () => {} }));
import viewer from "../src/data/csv-viewer";

const encode = (s: string) => new TextEncoder().encode(s);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

test("CSV edits preserve untouched bytes and external conflicts retain local changes", async () => {
  state.disk = encode('\ufeff"name",value\r\nalpha,1\n'); state.alerts = [];
  const root = document.createElement("div");
  await viewer.mount(root, "test.csv");
  const buttons = root.querySelectorAll("button");
  buttons[0].click(); await settle();
  const cells = root.querySelectorAll("textarea");
  cells[2].value = "beta"; cells[2].dispatchEvent(new Event("input"));
  buttons[1].click(); await settle();
  expect(state.disk).toEqual(encode('\ufeff"name",value\r\nbeta,1\n'));
  const edited = root.querySelectorAll("textarea")[2];
  edited.value = "local"; edited.dispatchEvent(new Event("input"));
  state.disk = encode("external\n");
  buttons[1].click(); await settle();
  expect(state.disk).toEqual(encode("external\n"));
  expect(edited.value).toBe("local");
  expect(state.alerts).toHaveLength(1);
  expect(await state.close()).toBe(false);
});
