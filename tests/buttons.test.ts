// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { menuButton, textButton } from "../src/ui/icons";

test("a text button is a plain button with the secondary look by default", () => {
  const b = textButton("편집");
  expect(b.type).toBe("button");
  expect(b.className).toBe("va-btn");
  expect(b.textContent).toBe("편집");
  expect(b.title).toBe("");
});

test("a text button carries its variant, shortcut and tooltip", () => {
  expect(textButton("재시작", "primary").className).toBe("va-btn va-btn-primary");
  expect(textButton("버리기", "danger").className).toBe("va-btn va-btn-danger");
  expect(textButton("목차", "ghost").className).toBe("va-btn va-btn-ghost");
  const save = textButton("저장", "secondary", { shortcut: "Ctrl+S" });
  expect(save.getAttribute("aria-keyshortcuts")).toBe("Ctrl+S");
  expect(save.title).toBe("저장 (Ctrl+S)");
  expect(textButton("편집", "secondary", { title: "편집 모드 (Ctrl+E)" }).title).toBe("편집 모드 (Ctrl+E)");
});

test("a menu button keeps its text and shows the shortcut beside it", () => {
  const b = menuButton("저장", "Ctrl+S");
  expect(b.type).toBe("button");
  expect(b.className).toBe("va3d-menu-item");
  expect(b.textContent).toBe("저장");
  expect(b.dataset.shortcut).toBe("Ctrl+S");
  expect(b.getAttribute("aria-keyshortcuts")).toBe("Ctrl+S");
  expect(menuButton("다시 읽기").hasAttribute("data-shortcut")).toBe(false);
});

test("no viewer builds a button without a type and a shared class", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : []);
  // Helpers that set type and class themselves; anything else must go through them.
  const OWN = /[\\/](ui[\\/]icons|titlebar|three[\\/]core[\\/](menubar|panel)|ui[\\/]recent-menu|update[\\/]badge|dev[\\/]gallery)\.ts$/;
  const raw = files("src").filter((f) => !OWN.test(f)).flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/createElement\(["']button["']\)|el\(["']button["']/g)].map(() => f));
  expect(raw).toEqual([]);
});
