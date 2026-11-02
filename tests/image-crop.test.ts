import { expect, test } from "vitest";
import { clampRect, dragRect, fitRect, hitTest, toImagePoint } from "../src/image/crop";

const image = { width: 200, height: 100 };
const whole = { x: 0, y: 0, width: 200, height: 100 };
const rect = { x: 50, y: 20, width: 60, height: 40 };

test("typed values keep the origin and shrink the size to fit", () => {
  expect(fitRect({ ...whole, x: 50 }, image)).toEqual({ x: 50, y: 0, width: 150, height: 100 });
  expect(fitRect({ x: 9999, y: 9999, width: 10, height: 10 }, image)).toEqual({ x: 199, y: 99, width: 1, height: 1 });
  expect(fitRect({ x: -5, y: 1.4, width: 0, height: Number.NaN }, image)).toEqual({ x: 0, y: 1, width: 1, height: 1 });
});

test("client coordinates map through the zoomed box and stay on the image", () => {
  const box = { left: 100, top: 50, width: 400, height: 200 };
  expect(toImagePoint({ x: 100, y: 50 }, box, image)).toEqual({ x: 0, y: 0 });
  expect(toImagePoint({ x: 300, y: 150 }, box, image)).toEqual({ x: 100, y: 50 });
  expect(toImagePoint({ x: 9999, y: -9999 }, box, image)).toEqual({ x: 200, y: 0 });
  expect(toImagePoint({ x: 100, y: 50 }, { ...box, width: 0, height: 0 }, image)).toEqual({ x: 0, y: 0 });
});

test("clamp keeps at least one pixel inside the image and repairs bad input", () => {
  expect(clampRect({ x: -5, y: -5, width: 10, height: 10 }, image)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  expect(clampRect({ x: 195, y: 95, width: 10, height: 10 }, image)).toEqual({ x: 190, y: 90, width: 10, height: 10 });
  expect(clampRect({ x: 0, y: 0, width: 0, height: -3 }, image)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  expect(clampRect({ x: NaN, y: 1.4, width: 99999, height: 2.6 }, image)).toEqual({ x: 0, y: 1, width: 200, height: 3 });
});

test("hit test picks corners, edges, the body and the outside", () => {
  expect(hitTest({ x: 50, y: 20 }, rect, image, 3)).toBe("nw");
  expect(hitTest({ x: 110, y: 60 }, rect, image, 3)).toBe("se");
  expect(hitTest({ x: 80, y: 20 }, rect, image, 3)).toBe("n");
  expect(hitTest({ x: 80, y: 60 }, rect, image, 3)).toBe("s");
  expect(hitTest({ x: 50, y: 40 }, rect, image, 3)).toBe("w");
  expect(hitTest({ x: 110, y: 40 }, rect, image, 3)).toBe("e");
  expect(hitTest({ x: 80, y: 40 }, rect, image, 3)).toBe("move");
  expect(hitTest({ x: 10, y: 10 }, rect, image, 3)).toBe("new");
});

test("the whole-image rectangle draws a new selection except at its border", () => {
  expect(hitTest({ x: 100, y: 50 }, whole, image, 3)).toBe("new");
  expect(hitTest({ x: 0, y: 50 }, whole, image, 3)).toBe("w");
  expect(hitTest({ x: 200, y: 100 }, whole, image, 3)).toBe("se");
});

test("a rectangle smaller than the grab zone keeps both edges reachable", () => {
  const thin = { x: 100, y: 50, width: 2, height: 2 };
  expect(hitTest({ x: 100, y: 51 }, thin, image, 5)).toBe("nw");
  expect(hitTest({ x: 102, y: 51 }, thin, image, 5)).toBe("ne");
});

test("drawing works in every direction", () => {
  expect(dragRect("new", { x: 10, y: 10 }, { x: 40, y: 30 }, whole, image)).toEqual({ x: 10, y: 10, width: 30, height: 20 });
  expect(dragRect("new", { x: 40, y: 30 }, { x: 10, y: 10 }, whole, image)).toEqual({ x: 10, y: 10, width: 30, height: 20 });
});

test("moving keeps the size and stops at the image border", () => {
  expect(dragRect("move", { x: 80, y: 40 }, { x: 90, y: 45 }, rect, image)).toEqual({ ...rect, x: 60, y: 25 });
  expect(dragRect("move", { x: 80, y: 40 }, { x: 900, y: 900 }, rect, image)).toEqual({ ...rect, x: 140, y: 60 });
  expect(dragRect("move", { x: 80, y: 40 }, { x: -900, y: -900 }, rect, image)).toEqual({ ...rect, x: 0, y: 0 });
});

test("resizing moves only the grabbed edges, stays on the image and mirrors past the opposite edge", () => {
  expect(dragRect("e", { x: 110, y: 40 }, { x: 120, y: 90 }, rect, image)).toEqual({ ...rect, width: 70 });
  expect(dragRect("n", { x: 80, y: 20 }, { x: 0, y: 10 }, rect, image)).toEqual({ ...rect, y: 10, height: 50 });
  expect(dragRect("se", { x: 110, y: 60 }, { x: 999, y: 999 }, rect, image)).toEqual({ x: 50, y: 20, width: 150, height: 80 });
  expect(dragRect("w", { x: 50, y: 40 }, { x: 130, y: 40 }, rect, image)).toEqual({ ...rect, x: 110, width: 20 });
  expect(dragRect("e", { x: 110, y: 40 }, { x: 50, y: 40 }, rect, image)).toEqual({ ...rect, width: 1 });
});
