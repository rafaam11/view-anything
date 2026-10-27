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
  onResized: vi.fn(async (cb: () => void) => { resized = cb; return unlisten; }),
  setTheme: vi.fn(async () => {}),
};
let dispose = () => {};
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const button = (action: string) => document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;

beforeEach(() => {
  vi.clearAllMocks();
  controls.isMaximized.mockResolvedValue(false);
  document.body.innerHTML = '<main id="app"></main>';
  document.title = "모델.step";
  applyTheme("system");
  dispose = mountTitlebar(document.body, controls);
});
afterEach(() => { dispose(); vi.restoreAllMocks(); });

test("theme is immediately before minimize, maximize and close; buttons never drag the window", () => {
  expect([...document.querySelectorAll(".va-titlebar button")].map((b) => (b as HTMLElement).dataset.action))
    .toEqual(["theme", "minimize", "maximize", "close"]);
  expect(document.body.firstElementChild?.className).toBe("va-titlebar");
  expect(document.querySelector(".va-titlebar-drag")?.hasAttribute("data-tauri-drag-region")).toBe(true);
  for (const b of document.querySelectorAll(".va-titlebar button")) {
    expect(b.closest("[data-tauri-drag-region]")).toBeNull();
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("aria-label")).toBeTruthy();
  }
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
  for (const name of ["minimize", "toggle-maximize", "start-dragging", "close", "set-theme"]) {
    expect(capability.permissions).toContain(`core:window:allow-${name}`);
  }
  const rust = readFileSync("src-tauri/src/lib.rs", "utf8");
  expect(rust).toContain(".decorations(false)");
});
