// @vitest-environment happy-dom
// main.ts drop / Ctrl+O routing per window kind (md regression, 3D append, empty -> 3D in place).
import { beforeEach, expect, test, vi } from "vitest";

type DropHandler = (ev: { payload: { type: string; paths?: string[] } }) => void;
let drop: DropHandler | null = null;
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (cb: DropHandler) => {
      drop = cb;
    },
  }),
}));

const platform = {
  openWindow: vi.fn(async (_p?: string) => {}),
  modifierShift: vi.fn(async (): Promise<boolean | null> => false),
  pickFiles: vi.fn(async (): Promise<string[]> => []),
  alert: vi.fn(async () => {}),
  setWindowTitle: vi.fn(async () => {}),
};
vi.mock("../src/platform", () => ({ platform }));
const cycleTheme = vi.fn();
vi.mock("../src/theme", () => ({ initializeTheme: () => {}, cycleTheme }));
vi.mock("../src/titlebar", () => ({ mountTitlebar: () => {} }));

const mdViewer = { mount: vi.fn(async () => {}) };
const threeViewer = {
  mount: vi.fn(async () => {}),
  accept: vi.fn((paths: string[], opts: { newWindow: boolean }) => (opts.newWindow ? paths : [])),
};
vi.mock("../src/registry", () => ({
  resolveViewer: (path: string) => {
    if (/\.md$/i.test(path)) return async () => mdViewer;
    if (/\.(stl|step|glb)$/i.test(path)) return async () => threeViewer;
    return null;
  },
}));

const MD = "D:\\d\\x.md";
const MD2 = "D:\\d\\y.md";
const A = "D:\\m\\a.step";
const B = "D:\\m\\b.stl";
const TXT = "D:\\d\\z.txt";
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

// main.ts installs window listeners at import; each test re-imports it, so drop the old ones.
const added: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][] = [];
const addListener = window.addEventListener.bind(window);
window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
  added.push([type, listener, opts]);
  addListener(type, listener, opts);
}) as typeof window.addEventListener;

async function start(file: string | null) {
  for (const [type, listener, opts] of added.splice(0)) window.removeEventListener(type, listener, opts);
  vi.resetModules();
  drop = null;
  history.replaceState(null, "", file ? "/?file=" + encodeURIComponent(file) : "/");
  document.body.innerHTML = '<div id="app"></div>';
  await import("../src/main");
  await settle();
}
const opened = () => platform.openWindow.mock.calls.map((c) => c[0]);
const fileParam = () => new URLSearchParams(location.search).get("file");

beforeEach(() => {
  vi.clearAllMocks();
  platform.modifierShift.mockImplementation(async () => false);
});

test("theme shortcut cycles once and ignores auto-repeat", async () => {
  await start(null);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "T", ctrlKey: true, shiftKey: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "T", ctrlKey: true, shiftKey: true, repeat: true }));
  expect(cycleTheme).toHaveBeenCalledTimes(1);
});

test("md window: every dropped file opens a new window (v0.1), shift or not", async () => {
  await start(MD);
  expect(mdViewer.mount).toHaveBeenCalledTimes(1);
  drop!({ payload: { type: "drop", paths: [A, MD2] } });
  await settle();
  platform.modifierShift.mockImplementation(async () => true);
  drop!({ payload: { type: "drop", paths: [B] } });
  await settle();
  expect(opened()).toEqual([A, MD2, B]);
  expect(threeViewer.accept).not.toHaveBeenCalled();
  expect(fileParam()).toBe(MD);
  expect(mdViewer.mount).toHaveBeenCalledTimes(1);
});

test("md window: Ctrl+O opens picked files in new windows (v0.1)", async () => {
  await start(MD);
  platform.pickFiles.mockResolvedValueOnce([A, MD2]);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true }));
  await settle();
  expect(opened()).toEqual([A, MD2]);
  expect(fileParam()).toBe(MD);
});

test("3D window: 3D files are appended, others open new windows", async () => {
  await start(A);
  drop!({ payload: { type: "drop", paths: [B, MD] } });
  await settle();
  expect(threeViewer.accept).toHaveBeenCalledWith([B], { newWindow: false });
  expect(opened()).toEqual([MD]);
});

test("3D window: Ctrl+O follows the drop rules", async () => {
  await start(A);
  platform.pickFiles.mockResolvedValueOnce([B, MD]);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true }));
  await settle();
  expect(threeViewer.accept).toHaveBeenCalledWith([B], { newWindow: false });
  expect(opened()).toEqual([MD]);
});

test("3D window: shift-drop (OS state) opens 3D files in new windows too", async () => {
  await start(A);
  platform.modifierShift.mockImplementation(async () => true);
  drop!({ payload: { type: "drop", paths: [B, MD] } });
  await settle();
  expect(threeViewer.accept).not.toHaveBeenCalled();
  expect(opened()).toEqual([B, MD]);
});

test("shift falls back to the JS-tracked key state when the OS cannot tell", async () => {
  await start(A);
  platform.modifierShift.mockImplementation(async () => null);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }));
  drop!({ payload: { type: "drop", paths: [B] } });
  await settle();
  expect(opened()).toEqual([B]);
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", shiftKey: false }));
  drop!({ payload: { type: "drop", paths: [B] } });
  await settle();
  expect(threeViewer.accept).toHaveBeenCalledWith([B], { newWindow: false });
});

test("while the 3D viewer is still mounting, other files open at once and Ctrl+O keeps working", async () => {
  let release!: () => void;
  threeViewer.mount.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
  await start(A);
  drop!({ payload: { type: "drop", paths: [B, MD] } });
  await settle();
  expect(opened()).toEqual([MD]); // not held back by the pending mount
  platform.pickFiles.mockResolvedValueOnce([MD2]).mockResolvedValueOnce([TXT]);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true }));
  await settle();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true }));
  await settle();
  expect(platform.pickFiles).toHaveBeenCalledTimes(2);
  expect(opened()).toEqual([MD, MD2, TXT]);
  release();
  await settle();
  expect(threeViewer.accept).toHaveBeenCalledWith([B], { newWindow: false });
});

test("empty window: a 3D first file mounts in place (no reload) and the rest of the 3D files append", async () => {
  await start(null);
  drop!({ payload: { type: "drop", paths: [A, B, MD] } });
  await settle();
  expect(fileParam()).toBe(A);
  expect(threeViewer.mount).toHaveBeenCalledTimes(1);
  expect((threeViewer.mount.mock.calls[0] as unknown[])[1]).toBe(A);
  expect(threeViewer.accept).toHaveBeenCalledWith([B], { newWindow: false });
  expect(opened()).toEqual([MD]);
  // the window is now a 3D window
  drop!({ payload: { type: "drop", paths: [B] } });
  await settle();
  expect(threeViewer.accept).toHaveBeenLastCalledWith([B], { newWindow: false });
});
