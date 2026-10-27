// @vitest-environment happy-dom
// Top-left menubar ("파일 · 보기"): open/close, actions, disabled items, check items, keyboard.
import { afterEach, expect, test, vi } from "vitest";
import { Menubar, type MenuSpec } from "../src/three/core/menubar";

afterEach(() => (document.body.innerHTML = ""));

function setup() {
  const open = vi.fn();
  const exportHtml = vi.fn();
  const update = vi.fn();
  let panel = true;
  const custom = document.createElement("div");
  custom.className = "custom";
  custom.append(Object.assign(document.createElement("input"), { type: "checkbox" }));
  const menus: MenuSpec[] = [
    {
      label: "파일",
      accessKey: "f",
      items: [
        { label: "열기…", shortcut: "Ctrl+O", run: open },
        { label: "HTML로 내보내기…", shortcut: "Ctrl+Shift+E", run: exportHtml },
        { separator: true },
        { label: "업데이트 확인", run: update, disabled: () => true, title: "다음 작업에서 연결" },
      ],
    },
    {
      label: "보기",
      accessKey: "v",
      items: [
        { label: "장면 패널 표시", checked: () => panel, run: () => (panel = !panel) },
        { element: custom },
      ],
    },
  ];
  const bar = new Menubar(menus);
  document.body.append(bar.root);
  const titles = [...bar.root.querySelectorAll<HTMLButtonElement>(".va3d-menu-title")];
  const dropdowns = [...bar.root.querySelectorAll<HTMLElement>(".va3d-menu")];
  return { bar, titles, dropdowns, open, exportHtml, update, custom, panel: () => panel };
}

test("titles open one dropdown at a time; an item runs and closes the menu", () => {
  const { bar, titles, dropdowns, open } = setup();
  expect(bar.root.getAttribute("role")).toBe("menubar");
  expect(titles.map((t) => t.textContent)).toEqual(["파일", "보기"]);
  expect(dropdowns.every((d) => d.hidden)).toBe(true);
  titles[0].click();
  expect(dropdowns[0].hidden).toBe(false);
  expect(titles[0].getAttribute("aria-expanded")).toBe("true");
  titles[1].click();
  expect(dropdowns[0].hidden).toBe(true);
  expect(dropdowns[1].hidden).toBe(false);
  titles[1].click(); // same title again: close
  expect(bar.isOpen).toBe(false);
  titles[0].click();
  const item = dropdowns[0].querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(item.textContent).toContain("열기…");
  expect(item.textContent).toContain("Ctrl+O");
  item.click();
  expect(open).toHaveBeenCalledOnce();
  expect(bar.isOpen).toBe(false);
});

test("hovering another title while a menu is open switches to it", () => {
  const { titles, dropdowns } = setup();
  titles[0].click();
  titles[1].dispatchEvent(new PointerEvent("pointerenter"));
  expect(dropdowns[1].hidden).toBe(false);
  expect(dropdowns[0].hidden).toBe(true);
});

test("disabled items carry their tooltip and do nothing", () => {
  const { titles, dropdowns, update, bar } = setup();
  titles[0].click();
  const items = [...dropdowns[0].querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  const upd = items.find((b) => b.textContent?.includes("업데이트 확인"))!;
  expect(upd.getAttribute("aria-disabled")).toBe("true");
  expect(upd.title).toBe("다음 작업에서 연결");
  upd.click();
  expect(update).not.toHaveBeenCalled();
  expect(bar.isOpen).toBe(true);
  expect(dropdowns[0].querySelector('[role="separator"]')).not.toBeNull();
});

test("check items reflect their state each time the menu opens; custom blocks keep the menu open", () => {
  const { titles, dropdowns, custom, bar, panel } = setup();
  titles[1].click();
  const check = dropdowns[1].querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
  expect(check.getAttribute("aria-checked")).toBe("true");
  check.click();
  expect(panel()).toBe(false);
  titles[1].click();
  expect(check.getAttribute("aria-checked")).toBe("false");
  expect(dropdowns[1].contains(custom)).toBe(true);
  custom.querySelector("input")!.click();
  expect(bar.isOpen).toBe(true);
});

test("Escape closes and returns focus to the title; a press outside closes", () => {
  const { titles, dropdowns, bar } = setup();
  titles[0].click();
  dropdowns[0].querySelector<HTMLElement>('[role="menuitem"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(bar.isOpen).toBe(false);
  expect(document.activeElement).toBe(titles[0]);
  titles[0].click();
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  expect(bar.isOpen).toBe(false);
  // close() reports whether something was open (the viewer's Escape falls through otherwise).
  expect(bar.close()).toBe(false);
  titles[0].click();
  expect(bar.close()).toBe(true);
});

test("keyboard: Alt+F / Alt+V open, arrows move between items and menus, disabled items are skipped", () => {
  const { titles, dropdowns, bar } = setup();
  expect(bar.handleKey(new KeyboardEvent("keydown", { key: "f", code: "KeyF", altKey: true }))).toBe(true);
  expect(dropdowns[0].hidden).toBe(false);
  const items = [...dropdowns[0].querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(document.activeElement).toBe(items[0]);
  const key = (k: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  key("ArrowDown");
  expect(document.activeElement).toBe(items[1]);
  key("ArrowDown"); // the update item is disabled: wraps to the first
  expect(document.activeElement).toBe(items[0]);
  key("ArrowUp");
  expect(document.activeElement).toBe(items[1]);
  key("ArrowRight");
  expect(dropdowns[1].hidden).toBe(false);
  key("ArrowLeft");
  expect(dropdowns[0].hidden).toBe(false);
  expect(bar.handleKey(new KeyboardEvent("keydown", { key: "v", code: "KeyV", altKey: true }))).toBe(true);
  expect(dropdowns[1].hidden).toBe(false);
  expect(bar.handleKey(new KeyboardEvent("keydown", { key: "x", code: "KeyX", altKey: true }))).toBe(false);
  expect(bar.handleKey(new KeyboardEvent("keydown", { key: "f", code: "KeyF" }))).toBe(false);
});
