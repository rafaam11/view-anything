// @vitest-environment happy-dom
// three.css layout rules that are easy to break by specificity: the narrow-width banner.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

const css = readFileSync(join(__dirname, "..", "src", "three", "core", "three.css"), "utf8");

type HappyWindow = Window & { happyDOM: { setViewport(v: { width: number; height: number }): void } };

function layout(panelClass: string): HTMLElement {
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = `<div class="va3d"><aside class="${panelClass}"></aside><div class="va3d-banner"></div></div>`;
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
