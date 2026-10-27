import { describe, expect, test } from "vitest";
import { basis } from "../src/three/core/frames";
import { STANDARD_VIEWS, fitDistance, standardViewDirection, standardViewUp } from "../src/three/core/views";

function mul3(m: number[], v: number[]): number[] {
  return [0, 1, 2].map((r) => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2]);
}
function expectVec(actual: number[], expected: number[]) {
  actual.forEach((a, i) => expect(a).toBeCloseTo(expected[i], 9));
}

describe("fitDistance", () => {
  test("is monotonically increasing in radius", () => {
    let prev = fitDistance(0.001, 45, 1.5);
    for (const r of [0.01, 0.1, 1, 10, 100, 1e4]) {
      const d = fitDistance(r, 45, 1.5);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  test("sphere exactly fits the vertical fov when the view is wide", () => {
    expect(fitDistance(1, 90, 2)).toBeCloseTo(1 / Math.sin(Math.PI / 4), 9);
  });

  test("narrow (portrait) views back off further than wide ones", () => {
    expect(fitDistance(1, 45, 0.5)).toBeGreaterThan(fitDistance(1, 45, 1));
    expect(fitDistance(1, 45, 2)).toBeCloseTo(fitDistance(1, 45, 1), 9);
  });
});

describe("standardViewDirection", () => {
  test("Z-up display: top is +Z, front is +X, right is -Y", () => {
    expectVec(standardViewDirection("top", "zup-rh"), [0, 0, 1]);
    expectVec(standardViewDirection("bottom", "zup-rh"), [0, 0, -1]);
    expectVec(standardViewDirection("front", "zup-rh"), [1, 0, 0]);
    expectVec(standardViewDirection("back", "zup-rh"), [-1, 0, 0]);
    expectVec(standardViewDirection("right", "zup-rh"), [0, -1, 0]);
    expectVec(standardViewDirection("left", "zup-rh"), [0, 1, 0]);
  });

  test("top view in any display frame points along that frame's up", () => {
    expectVec(standardViewDirection("top", "yup-rh"), [0, 1, 0]);
    expectVec(standardViewDirection("top", "yup-lh"), [0, 1, 0]);
  });

  test("directions are unit vectors and map back to the same canonical direction", () => {
    for (const name of STANDARD_VIEWS) {
      const c = standardViewDirection(name, "zup-rh");
      expect(Math.hypot(c[0], c[1], c[2])).toBeCloseTo(1, 12);
      for (const p of ["yup-rh", "yup-lh", "zup-lh", "ros"] as const) {
        expectVec(mul3(basis(p), standardViewDirection(name, p)), c);
      }
    }
  });

  test("up vector is display up, except top/bottom which use forward", () => {
    expectVec(standardViewUp("front", "zup-rh"), [0, 0, 1]);
    expectVec(standardViewUp("iso", "yup-rh"), [0, 1, 0]);
    expectVec(standardViewUp("top", "zup-rh"), [1, 0, 0]);
    expectVec(standardViewUp("bottom", "zup-rh"), [1, 0, 0]);
  });
});
