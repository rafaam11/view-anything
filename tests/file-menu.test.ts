// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { fileMenu } from "../src/ui/file-menu";
import type { MenuItem } from "../src/three/core/menubar";

afterEach(() => vi.restoreAllMocks());

const shape = (items: MenuItem[]) => items.map((i) => ("separator" in i ? "—" : "element" in i ? `[${i.label}]` : `${i.label}${"shortcut" in i && i.shortcut ? ` ${i.shortcut}` : ""}`));

test("every 파일 menu starts with the same open items, then recent files", () => {
  expect(shape(fileMenu(() => {}))).toEqual(["열기… Ctrl+O", "텍스트로 열기… Ctrl+Shift+O", "—", "[최근 파일]"]);
});

test("a viewer adds its own open items after them and its commands at the end", () => {
  const items = fileMenu(() => {}, {
    open: [{ label: "장면에 추가…", run: () => {} }],
    actions: [{ label: "HTML로 내보내기…", shortcut: "Ctrl+Shift+E", run: () => {} }],
  });
  expect(shape(items)).toEqual(["열기… Ctrl+O", "텍스트로 열기… Ctrl+Shift+O", "장면에 추가…", "—", "[최근 파일]", "—", "HTML로 내보내기… Ctrl+Shift+E"]);
});

test("the open items ask main.ts to open, as a file or as text", () => {
  const seen: unknown[] = [];
  const listen = (e: Event) => seen.push((e as CustomEvent).detail ?? null);
  window.addEventListener("va:open", listen);
  try {
    const [open, text] = fileMenu(() => {}) as { run(): void }[];
    open.run();
    text.run();
    expect(seen).toEqual([null, { text: true }]);
  } finally {
    window.removeEventListener("va:open", listen);
  }
});
