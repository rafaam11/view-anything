// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mountTitlebar } from "../src/titlebar";
import { applyTheme, cycleTheme } from "../src/theme";

let resized = () => {};
const unlisten = vi.fn();
const controls = {
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  isFullscreen: vi.fn(async () => false),
  isAlwaysOnTop: vi.fn(async () => false),
  setAlwaysOnTop: vi.fn(async (_on: boolean) => {}),
  onResized: vi.fn(async (cb: () => void) => { resized = cb; return unlisten; }),
  setTheme: vi.fn(async () => {}),
};
let dispose = () => {};
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;

beforeEach(() => {
  vi.clearAllMocks();
  controls.isMaximized.mockResolvedValue(false);
  controls.isFullscreen.mockResolvedValue(false);
  controls.isAlwaysOnTop.mockResolvedValue(false);
  controls.setAlwaysOnTop.mockImplementation(async (on: boolean) => {
    controls.isAlwaysOnTop.mockResolvedValue(on);
  });
  delete document.documentElement.dataset.fullscreen;
  document.body.innerHTML = '<main id="app"></main>';
  document.title = "모델.step";
  applyTheme("system");
  dispose = mountTitlebar(document.body, controls);
});
afterEach(() => { dispose(); vi.restoreAllMocks(); });

test("settings, theme and pin precede window controls; buttons never drag the window", () => {
  expect([...document.querySelectorAll(".va-titlebar button")].map((b) => (b as HTMLElement).dataset.action))
    .toEqual(["settings", "theme", "pin", "minimize", "maximize", "close"]);
  expect(document.body.firstElementChild?.className).toBe("va-titlebar");
  expect(document.querySelector(".va-titlebar-drag")?.hasAttribute("data-tauri-drag-region")).toBe(true);
  for (const b of document.querySelectorAll(".va-titlebar button")) {
    expect(b.closest("[data-tauri-drag-region]")).toBeNull();
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("aria-label")).toBeTruthy();
  }
});

test("pin toggles native always-on-top with accessible state and distinct icons", async () => {
  await settle();
  const pin = button("pin");
  const offIcon = pin.innerHTML;
  expect(pin.getAttribute("aria-pressed")).toBe("false");
  expect(pin.title).toBe("항상 위에 표시");
  pin.click();
  await settle();
  expect(controls.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
  expect(pin.getAttribute("aria-pressed")).toBe("true");
  expect(pin.title).toBe("항상 위 해제");
  expect(pin.getAttribute("aria-label")).toBe(pin.title);
  expect(pin.innerHTML).not.toBe(offIcon);
  pin.click();
  await settle();
  expect(controls.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  expect(pin.getAttribute("aria-pressed")).toBe("false");
  expect(pin.innerHTML).toBe(offIcon);
});

test("pin reads native state on remount and does not set it on initialization", async () => {
  await settle();
  dispose();
  controls.isAlwaysOnTop.mockResolvedValue(true);
  dispose = mountTitlebar(document.body, controls);
  await settle();
  expect(button("pin").getAttribute("aria-pressed")).toBe("true");
  expect(controls.setAlwaysOnTop).not.toHaveBeenCalled();
});

test("pin ignores rapid clicks while a native change is pending", async () => {
  await settle();
  let finish!: () => void;
  controls.setAlwaysOnTop.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finish = () => { controls.isAlwaysOnTop.mockResolvedValue(true); resolve(); };
  }));
  button("pin").click();
  button("pin").click();
  await settle();
  expect(controls.setAlwaysOnTop).toHaveBeenCalledTimes(1);
  expect(button("pin").disabled).toBe(true);
  button("pin").click();
  finish();
  await settle();
  expect(controls.setAlwaysOnTop).toHaveBeenCalledTimes(1);
  expect(button("pin").disabled).toBe(false);
  expect(button("pin").getAttribute("aria-pressed")).toBe("true");
});

test("failed pin changes preserve the displayed state and allow retry", async () => {
  await settle();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  controls.setAlwaysOnTop.mockRejectedValueOnce(new Error("native failure"));
  button("pin").click();
  await settle();
  expect(button("pin").getAttribute("aria-pressed")).toBe("false");
  expect(button("pin").disabled).toBe(false);
  expect(warn).toHaveBeenCalled();
  button("pin").click();
  await settle();
  expect(button("pin").getAttribute("aria-pressed")).toBe("true");
});

test("clicks and shortcuts update icon, accessible tooltip and native/system theme", async () => {
  await settle();
  expect(button("theme").dataset.mode).toBe("system");
  expect(controls.setTheme).toHaveBeenLastCalledWith(null);
  button("theme").click();
  await settle();
  expect(button("theme").dataset.mode).toBe("dark");
  expect(button("theme").title).toContain("다크 모드 · 클릭: 라이트 모드");
  expect(controls.setTheme).toHaveBeenLastCalledWith("dark");
  cycleTheme(); // same path as Ctrl+Shift+T
  await settle();
  expect(button("theme").dataset.mode).toBe("light");
  expect(button("theme").getAttribute("aria-label")).toBe(button("theme").title);
  button("theme").click();
  await settle();
  expect(controls.setTheme).toHaveBeenLastCalledWith(null);
});

test("minimize and close call native requests, and maximize tracks external changes", async () => {
  button("minimize").click();
  button("close").click();
  controls.isMaximized.mockResolvedValue(true);
  button("maximize").click();
  await settle();
  expect(controls.minimize).toHaveBeenCalledTimes(1);
  expect(controls.close).toHaveBeenCalledTimes(1); // never destroy()
  expect(controls.toggleMaximize).toHaveBeenCalledTimes(1);
  expect(button("maximize").title).toBe("이전 크기로 복원");
  controls.isMaximized.mockResolvedValue(false);
  resized();
  await settle();
  expect(button("maximize").title).toBe("최대화");
});

test("full screen follows the native window on mount and on resize", async () => {
  await settle();
  expect(document.documentElement.dataset.fullscreen).toBeUndefined();
  controls.isFullscreen.mockResolvedValue(true);
  resized();
  await settle();
  expect(document.documentElement.dataset.fullscreen).toBe("true");
  // A page reload (another format opened while in full screen) mounts a new titlebar.
  dispose();
  delete document.documentElement.dataset.fullscreen;
  dispose = mountTitlebar(document.body, controls);
  await settle();
  expect(document.documentElement.dataset.fullscreen).toBe("true");
  controls.isFullscreen.mockResolvedValue(false);
  resized();
  await settle();
  expect(document.documentElement.dataset.fullscreen).toBeUndefined();
});

test("reflects dirty file titles as text, not markup", async () => {
  document.title = "● <img src=x onerror=alert(1)>.md";
  await settle();
  expect(document.querySelector(".va-titlebar-title")?.textContent).toBe(document.title);
  expect(document.querySelector(".va-titlebar img")).toBeNull();
});

test("disposes resize and DOM observers", async () => {
  await settle();
  dispose();
  const calls = controls.setTheme.mock.calls.length;
  applyTheme("dark");
  await settle();
  expect(controls.setTheme).toHaveBeenCalledTimes(calls);
  expect(unlisten).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".va-titlebar")).toBeNull();
});

test("every native window control has an explicit capability", () => {
  const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
  for (const name of ["minimize", "toggle-maximize", "start-dragging", "close", "set-theme", "set-fullscreen", "set-always-on-top"]) {
    expect(capability.permissions).toContain(`core:window:allow-${name}`);
  }
  const rust = readFileSync("src-tauri/src/lib.rs", "utf8");
  expect(rust).toContain(".decorations(false)");
});
