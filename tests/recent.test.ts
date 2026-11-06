// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { addRecent, clearRecent, onRecentChange, parseRecent, RECENT_KEY, recentFiles, removeRecent } from "../src/recent";
import { documentBar } from "../src/ui/chrome";

beforeEach(() => localStorage.clear());

test("recent paths are deduplicated, newest first and capped", () => {
  for (let i = 0; i < 25; i++) addRecent(`D:\\f${i}.md`);
  addRecent("D:\\f23.md");
  expect(recentFiles()[0]).toBe("D:\\f23.md");
  expect(recentFiles()[1]).toBe("D:\\f24.md");
  expect(recentFiles()).toHaveLength(20);
  expect(new Set(recentFiles()).size).toBe(20);
});

test("broken storage values are ignored", () => {
  expect(parseRecent(null)).toEqual([]);
  expect(parseRecent("{")).toEqual([]);
  expect(parseRecent('{"a":1}')).toEqual([]);
  expect(parseRecent('[1,"a",null,"a","","b"]')).toEqual(["a", "b"]);
});

test("removing and clearing", () => {
  addRecent("a"); addRecent("b");
  removeRecent("a");
  expect(recentFiles()).toEqual(["b"]);
  clearRecent();
  expect(recentFiles()).toEqual([]);
});

test("this window and other windows hear about changes", () => {
  const seen = vi.fn();
  const off = onRecentChange(seen);
  window.dispatchEvent(new StorageEvent("storage", { key: RECENT_KEY }));
  window.dispatchEvent(new StorageEvent("storage", { key: "va.theme" }));
  addRecent("x");
  expect(seen).toHaveBeenCalledTimes(2);
  off();
  addRecent("y");
  expect(seen).toHaveBeenCalledTimes(2);
});

test("the file menu shows recent files, opens one and closes itself", () => {
  addRecent("D:/docs/b.md"); addRecent("D:/docs/a.csv");
  const bar = document.createElement("header"); document.body.append(bar);
  documentBar(bar);
  const title = bar.querySelector<HTMLButtonElement>(".va3d-menu-title")!;
  title.click();
  const menu = bar.querySelector<HTMLElement>(".va3d-menu:not([hidden])")!;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>(".va-recent button")];
  expect(buttons.map((b) => b.textContent)).toEqual(["a.csv", "b.md", "목록 지우기"]);
  const opened = vi.fn();
  window.addEventListener("va:open-path", (e) => opened((e as CustomEvent).detail.path), { once: true });
  buttons[1].click();
  expect(opened).toHaveBeenCalledWith("D:/docs/b.md");
  expect(bar.querySelector(".va3d-menu:not([hidden])")).toBeNull();
  addRecent("D:/docs/c.txt");
  expect(menu.querySelector(".va-recent button")!.textContent).toBe("c.txt");
  bar.remove();
});
