import { describe, expect, test } from "vitest";
import {
  FRAME_PRESETS,
  UNIT_MM,
  applyMatrix4,
  basis,
  det3,
  displayRootMatrix,
  multiply4,
  objectMatrix,
  toDisplay,
  toSource,
  type FramePreset,
  type Unit,
} from "../src/three/core/frames";

const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 3x3 times vector. */
function mul3(m: number[], v: number[]): number[] {
  return [0, 1, 2].map((r) => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2]);
}

function expectVec(actual: number[], expected: number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((a, i) => expect(a).toBeCloseTo(expected[i], 9));
}

describe("basis", () => {
  test("right-handed presets have det +1, left-handed have det -1", () => {
    expect(det3(basis("zup-rh"))).toBeCloseTo(1, 12);
    expect(det3(basis("yup-rh"))).toBeCloseTo(1, 12);
    expect(det3(basis("ros"))).toBeCloseTo(1, 12);
    expect(det3(basis("yup-lh"))).toBeCloseTo(-1, 12);
    expect(det3(basis("zup-lh"))).toBeCloseTo(-1, 12);
  });

  test("each preset's own up axis maps to canonical up (0,0,1)", () => {
    expectVec(mul3(basis("zup-rh"), [0, 0, 1]), [0, 0, 1]);
    expectVec(mul3(basis("ros"), [0, 0, 1]), [0, 0, 1]);
    expectVec(mul3(basis("zup-lh"), [0, 0, 1]), [0, 0, 1]);
    expectVec(mul3(basis("yup-rh"), [0, 1, 0]), [0, 0, 1]);
    expectVec(mul3(basis("yup-lh"), [0, 1, 0]), [0, 0, 1]);
  });

  test("Y-up front (+Z) faces the CAD front-view camera at C -Y", () => {
    expectVec(mul3(basis("yup-rh"), [0, 0, 1]), [0, -1, 0]); // glTF/SolidWorks front
    expectVec(mul3(basis("yup-lh"), [0, 0, 1]), [0, -1, 0]); // Unity forward
  });

  test("Y-up conversion keeps X fixed for RH and mirrors it for Unity LH", () => {
    expectVec(mul3(basis("yup-rh"), [1, 0, 0]), [1, 0, 0]);
    // Unity's +X (its right) shows on screen left when its front faces the camera
    expectVec(mul3(basis("yup-lh"), [1, 0, 0]), [-1, 0, 0]);
  });

  test("Z-up presets keep X; Unreal mirrors Y", () => {
    expectVec(mul3(basis("ros"), [1, 0, 0]), [1, 0, 0]);
    expectVec(mul3(basis("zup-lh"), [1, 0, 0]), [1, 0, 0]);
    expectVec(mul3(basis("zup-lh"), [0, 1, 0]), [0, -1, 0]);
  });

  test("Y-up bases match the Rx(+90°) literal", () => {
    expect(basis("yup-rh")).toEqual([1, 0, 0, 0, 0, 1, 0, -1, 0]);
    expect(basis("yup-lh")).toEqual([-1, 0, 0, 0, 0, 1, 0, -1, 0]);
  });

  test("ros and zup-rh are identity, all bases are orthonormal", () => {
    expect(basis("ros")).toEqual(basis("zup-rh"));
    for (const p of FRAME_PRESETS) {
      const b = basis(p);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const dot = b[i * 3] * b[j * 3] + b[i * 3 + 1] * b[j * 3 + 1] + b[i * 3 + 2] * b[j * 3 + 2];
          expect(dot).toBeCloseTo(i === j ? 1 : 0, 12);
        }
      }
    }
  });
});

describe("displayRootMatrix", () => {
  test("default Z-up display sends (0,0,1) to three world (0,1,0)", () => {
    expectVec(applyMatrix4(displayRootMatrix("zup-rh"), [0, 0, 1]), [0, 1, 0]);
  });

  test("Y-up RH display is identity in three world", () => {
    expectVec(displayRootMatrix("yup-rh"), IDENTITY4);
  });

  test("every display preset sends its own up to world +Y", () => {
    const ups: Record<FramePreset, number[]> = {
      "zup-rh": [0, 0, 1],
      ros: [0, 0, 1],
      "zup-lh": [0, 0, 1],
      "yup-rh": [0, 1, 0],
      "yup-lh": [0, 1, 0],
    };
    for (const p of FRAME_PRESETS) expectVec(applyMatrix4(displayRootMatrix(p), ups[p]), [0, 1, 0]);
  });
});

describe("objectMatrix", () => {
  test("as-is frame and as-is unit is identity", () => {
    expectVec(objectMatrix("zup-rh", "mm", "as-is", "as-is"), IDENTITY4);
    expectVec(objectMatrix("yup-lh", "m", "as-is", "as-is"), IDENTITY4);
  });

  test("UNIT_MM table", () => {
    expect(UNIT_MM).toEqual({ mm: 1, cm: 10, m: 1000, in: 25.4 });
  });

  test("inch source in mm display scales by 25.4", () => {
    const m = objectMatrix("zup-rh", "mm", "as-is", "in");
    expectVec(applyMatrix4(m, [1, 2, 3]), [25.4, 50.8, 76.2]);
    expect(objectMatrix("zup-rh", "mm", "zup-rh", "in")[0]).toBeCloseTo(25.4, 12);
  });

  test("ros source (m) shown in default display (mm) scales by 1000", () => {
    expectVec(applyMatrix4(objectMatrix("zup-rh", "mm", "ros", "m"), [1, 0, 0]), [1000, 0, 0]);
  });

  test("yup-rh source up becomes zup-rh display up", () => {
    expectVec(applyMatrix4(objectMatrix("zup-rh", "mm", "yup-rh", "as-is"), [0, 1, 0]), [0, 0, 1]);
  });

  test("round trip between any two frames/units is identity", () => {
    const units: Unit[] = ["mm", "cm", "m", "in"];
    for (const d of FRAME_PRESETS) {
      for (const s of FRAME_PRESETS) {
        for (const ud of units) {
          for (const us of units) {
            const there = objectMatrix(d, ud, s, us);
            const back = objectMatrix(s, us, d, ud);
            expectVec(multiply4(back, there), IDENTITY4);
          }
        }
      }
    }
  });

  test("returns column-major 16 numbers (translation slots stay zero)", () => {
    const m = objectMatrix("zup-rh", "mm", "yup-lh", "cm");
    expect(m).toHaveLength(16);
    expect([m[3], m[7], m[11], m[12], m[13], m[14]]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(m[15]).toBe(1);
  });
});

describe("toDisplay / toSource", () => {
  test("convert points between source and display coordinates", () => {
    const p = [1, 2, 3];
    const d = toDisplay(p, "zup-rh", "mm", "yup-rh", "in");
    // yup-rh (x,y,z) -> canonical (x,-z,y); 1in = 25.4mm
    expectVec(d, [25.4, -76.2, 50.8]);
    expectVec(toSource(d, "zup-rh", "mm", "yup-rh", "in"), p);
  });

  test("as-is leaves points untouched", () => {
    expectVec(toDisplay([4, 5, 6], "zup-lh", "cm", "as-is", "as-is"), [4, 5, 6]);
    expectVec(toSource([4, 5, 6], "zup-lh", "cm", "as-is", "as-is"), [4, 5, 6]);
  });
});
