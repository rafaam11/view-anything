import { expect, test } from "vitest";
import { isOpenKey, routeOpen } from "../src/open-route";

test("empty window opens the first file here and the rest in new windows", () => {
  expect(routeOpen(null, ["D:\\a.md"])).toEqual({ here: "D:\\a.md", windows: [] });
  expect(routeOpen(null, ["D:\\a.md", "D:\\b.md"])).toEqual({ here: "D:\\a.md", windows: ["D:\\b.md"] });
});

test("a window showing a document never replaces it", () => {
  expect(routeOpen("D:\\x.md", ["D:\\a.md", "D:\\b.md"])).toEqual({ here: null, windows: ["D:\\a.md", "D:\\b.md"] });
});

test("nothing picked does nothing", () => {
  expect(routeOpen(null, [])).toEqual({ here: null, windows: [] });
  expect(routeOpen("D:\\x.md", [])).toEqual({ here: null, windows: [] });
});

test("ctrl+o is the open shortcut, with no other modifier", () => {
  const k = (key: string, m: Partial<KeyboardEvent> = {}) =>
    ({ key, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...m }) as KeyboardEvent;
  expect(isOpenKey(k("o"))).toBe(true);
  expect(isOpenKey(k("O"))).toBe(true);
  expect(isOpenKey(k("o", { shiftKey: true }))).toBe(false);
  expect(isOpenKey(k("o", { altKey: true }))).toBe(false);
  expect(isOpenKey(k("o", { ctrlKey: false }))).toBe(false);
  expect(isOpenKey(k("p"))).toBe(false);
  expect(isOpenKey(k("o", { repeat: true }))).toBe(false);
});
