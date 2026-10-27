// @vitest-environment happy-dom
// three.css layout rules that are easy to break by specificity: the narrow-width banner.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

const css = readFileSync(join(__dirname, "..", "src", "three", "core", "three.css"), "utf8");

type HappyWindow = Window & { happyDOM: { setViewport(v: { width: number; height: number }): void } };

function layout(panelClass: string): HTMLElement {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = `<div class="va3d"><aside class="${panelClass}"></aside><div class="va3d-toolbar"></div><div class="va3d-banner"></div></div>`;
  return document.querySelector<HTMLElement>(".va3d-banner")!;
}

afterEach(() => (window as HappyWindow).happyDOM.setViewport({ width: 1024, height: 768 }));

test.each(["va3d-panel", "va3d-panel collapsed"])("narrow window (500px): the banner spans the width with panel class %s", (panelClass) => {
  (window as HappyWindow).happyDOM.setViewport({ width: 500, height: 700 });
  const s = getComputedStyle(layout(panelClass));
  expect(s.left).toBe("8px");
  expect(s.right).toBe("8px");
  expect(s.maxWidth).toBe("none");
});

test("wide window: the banner starts right of the (collapsed) panel", () => {
  (window as HappyWindow).happyDOM.setViewport({ width: 1200, height: 800 });
  expect(getComputedStyle(layout("va3d-panel")).left).toBe("276px");
  expect(getComputedStyle(layout("va3d-panel collapsed")).left).toBe("56px");
});

// Top-row budget (see three.css): panel 8+260px, toolbar ~470px + 8px, banner min 240px.
const TOOLBAR_BUDGET = 470;
const PANEL_RIGHT = 268;

test.each([
  [1000, "va3d-panel", "276px"],
  [1000, "va3d-panel collapsed", "56px"],
  [850, "va3d-panel", "276px"],
  [850, "va3d-panel collapsed", "56px"],
])("mid window (%ipx, %s): the banner drops below the toolbar", (width, panelClass, left) => {
  (window as HappyWindow).happyDOM.setViewport({ width, height: 800 });
  const s = getComputedStyle(layout(panelClass));
  expect(s.top).toBe("48px");
  expect(s.left).toBe(left);
  expect(s.right).toBe("8px");
  expect(s.minWidth).toMatch(/^0(px)?$/);
  // The open panel still clears the toolbar on this row.
  expect(PANEL_RIGHT + 8 + TOOLBAR_BUDGET + 8).toBeLessThan(width);
});

test.each(["va3d-panel", "va3d-panel collapsed"])("800px window (%s): banner at the bottom, toolbar may wrap", (panelClass) => {
  (window as HappyWindow).happyDOM.setViewport({ width: 800, height: 700 });
  const s = getComputedStyle(layout(panelClass));
  expect(s.top).toBe("auto");
  expect(s.bottom).toBe("84px");
  expect(s.left).toBe("8px");
  expect(getComputedStyle(document.querySelector<HTMLElement>(".va3d-toolbar")!).flexWrap).toBe("wrap");
});

test("wide window (1100px): banner on the top row fits between panel and toolbar", () => {
  (window as HappyWindow).happyDOM.setViewport({ width: 1100, height: 800 });
  const s = getComputedStyle(layout("va3d-panel"));
  expect(s.top).toBe("8px");
  expect(s.left).toBe("276px");
  // max-width calc(100% - 762px) leaves the toolbar budget free and is at least min-width (240px).
  expect(1100 - 762).toBeGreaterThanOrEqual(240);
  expect(276 + (1100 - 762) + 8 + TOOLBAR_BUDGET + 8).toBeLessThanOrEqual(1100);
});
