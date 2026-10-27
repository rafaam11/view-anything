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
  // repeats are still recognized so main.ts can swallow them (it only acts when !e.repeat)
  expect(isOpenKey(k("o", { repeat: true }))).toBe(true);
});

import { routeDrop, windowTitle } from "../src/open-route";

const A = "D:\\m\\a.step";
const B = "D:\\m\\b.STL";
const G = "D:\\m\\c.glb";
const MD = "D:\\d\\x.md";
const TXT = "D:\\d\\y.txt";

test.each([
  // current, paths, shift, expected
  ["empty", [], false, { append: [], windows: [] }],
  ["empty", [A], false, { here: A, append: [], windows: [] }],
  ["empty", [A, B, MD, G], false, { here: A, append: [B, G], windows: [MD] }],
  ["empty", [A, B, MD], true, { here: A, append: [], windows: [B, MD] }],
  ["empty", [MD, A, B], false, { here: MD, append: [], windows: [A, B] }],
  ["empty", [MD, A], true, { here: MD, append: [], windows: [A] }],
  ["empty", [TXT, A], false, { here: TXT, append: [], windows: [A] }],
  ["md", [A, B], false, { append: [], windows: [A, B] }],
  ["md", [A, MD], true, { append: [], windows: [A, MD] }],
  ["md", [MD], false, { append: [], windows: [MD] }],
  ["3d", [A, MD, B, TXT], false, { append: [A, B], windows: [MD, TXT] }],
  ["3d", [A, MD, B], true, { append: [], windows: [A, MD, B] }],
  ["3d", [MD], false, { append: [], windows: [MD] }],
  ["3d", [], true, { append: [], windows: [] }],
] as const)("routeDrop(%s, %j, shift=%s)", (current, paths, shift, expected) => {
  expect(routeDrop(current, [...paths], shift)).toEqual(expected);
});

test("routeDrop matches v0.1 routeOpen for md windows and md-first empty windows", () => {
  for (const paths of [[MD], [MD, A], [A, MD, B]]) {
    for (const shift of [false, true]) {
      const r = routeDrop("md", paths, shift);
      expect({ here: r.here ?? null, windows: r.windows }).toEqual(routeOpen("D:\\cur.md", paths));
    }
  }
  const r = routeDrop("empty", [MD, TXT], false);
  expect({ here: r.here ?? null, windows: r.windows }).toEqual(routeOpen(null, [MD, TXT]));
});

test("windowTitle: one name, or the first plus a count", () => {
  expect(windowTitle([])).toBe("view-anything");
  expect(windowTitle(["a.step"])).toBe("a.step");
  expect(windowTitle(["a.step", "b.stl", "c.glb"])).toBe("a.step 외 2개");
});
