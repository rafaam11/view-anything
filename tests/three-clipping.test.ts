// Section planes: defined on display-frame axes, applied in three's world through the display root.
import { expect, test } from "vitest";
import { Matrix4, Vector3 } from "three";
import { clipPlane, Clipper } from "../src/three/core/clipping";
import { applyMatrix4, displayRootMatrix, FRAME_PRESETS } from "../src/three/core/frames";

const M = (p: (typeof FRAME_PRESETS)[number]) => new Matrix4().fromArray(displayRootMatrix(p));
const world = (p: (typeof FRAME_PRESETS)[number], d: number[]) => new Vector3(...(applyMatrix4(displayRootMatrix(p), d) as [number, number, number]));

test("default display (Z-up RH): a Z section at 5 keeps display z <= 5, i.e. world y <= 5", () => {
  const plane = clipPlane(2, 5, M("zup-rh"));
  expect(plane.distanceToPoint(new Vector3(0, 4, 0))).toBeGreaterThan(0);
  expect(plane.distanceToPoint(new Vector3(0, 6, 0))).toBeLessThan(0);
  expect(plane.normal.toArray().map((x) => Math.round(x) + 0)).toEqual([0, -1, 0]);
});

test.each(FRAME_PRESETS)("display %s: every axis section keeps exactly the display points at or below the value", (preset) => {
  const pts = [
    [1, 2, 3],
    [-4, 0.5, 7],
    [3, -2, -1],
    [0, 9, 2],
  ];
  for (const axis of [0, 1, 2] as const) {
    const plane = clipPlane(axis, 1.5, M(preset));
    for (const d of pts) {
      const kept = plane.distanceToPoint(world(preset, d)) >= 0;
      expect(kept, `${preset} axis ${axis} point ${d}`).toBe(d[axis] <= 1.5);
    }
  }
});

test("Clipper: one shared plane array; enabling and moving planes mutates it in place", () => {
  const c = new Clipper();
  const shared = c.planes;
  expect(shared).toEqual([]);
  c.setRange([0, 0, 0], [10, 20, 30]);
  c.setDisplayMatrix(M("zup-rh"));
  c.setEnabled(0, true);
  expect(c.planes).toBe(shared);
  expect(shared).toHaveLength(1);
  expect(c.value(0)).toBe(5); // first enabled at the middle of the range
  c.setFraction(2, 0.25);
  expect(shared).toHaveLength(2);
  expect(c.value(2)).toBe(7.5);
  // Z at 7.5 -> world y = 7.5
  expect(shared[1].distanceToPoint(new Vector3(0, 7, 0))).toBeGreaterThan(0);
  expect(shared[1].distanceToPoint(new Vector3(0, 8, 0))).toBeLessThan(0);
  c.setEnabled(0, false);
  expect(shared).toHaveLength(1);
  expect(c.active()).toBe(true);
  c.setEnabled(2, false);
  expect(c.active()).toBe(false);
  c.setEnabled(2, true);
  expect(c.value(2)).toBe(7.5); // re-enabled where it was
});

test("Clipper: a range change (hide, append) moves the slider, never the plane", () => {
  const c = new Clipper();
  c.setRange([0, 0, 0], [10, 10, 10]);
  c.setDisplayMatrix(M("zup-rh"));
  c.setFraction(1, 0.5);
  expect(c.value(1)).toBe(5);
  c.setRange([0, -10, 0], [10, 30, 10]);
  expect(c.value(1)).toBe(5);
  expect(c.fraction(1)).toBe(0.375);
  // Out of a shrunken range: the plane stays, the slider clamps.
  c.setRange([0, 0, 0], [10, 2, 10]);
  expect(c.value(1)).toBe(5);
  expect(c.fraction(1)).toBe(1);
  c.setDisplayMatrix(M("yup-rh"));
  // Y-up display: display Y is world Y, keep display y <= 5.
  expect(c.planes[0].distanceToPoint(new Vector3(0, 4, 0))).toBeGreaterThan(0);
  expect(c.planes[0].distanceToPoint(new Vector3(0, 6, 0))).toBeLessThan(0);
});

test("Clipper: unit change rescales values; frame change clamps them into the new range", () => {
  const c = new Clipper();
  c.setRange([0, 0, 0], [100, 100, 100]);
  c.setDisplayMatrix(M("zup-rh"));
  c.setValue(0, 40); // mm
  c.scale(1 / 10); // mm -> cm
  expect(c.value(0)).toBe(4);
  c.setRange([10, 0, 0], [20, 10, 10]);
  c.clampToRange();
  expect(c.value(0)).toBe(10);
});

test("Clipper.clipped tells whether a world point is cut away by an active plane", () => {
  const c = new Clipper();
  c.setRange([0, 0, 0], [10, 10, 10]);
  c.setDisplayMatrix(M("zup-rh"));
  expect(c.clipped(new Vector3(0, 100, 0))).toBe(false);
  c.setFraction(2, 0.5);
  expect(c.clipped(new Vector3(0, 6, 0))).toBe(true);
  expect(c.clipped(new Vector3(0, 4, 0))).toBe(false);
});
