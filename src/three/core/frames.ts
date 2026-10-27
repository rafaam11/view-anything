/**
 * Coordinate frame presets and unit scaling.
 *
 * Pure math on plain number arrays: no three.js, no Tauri. Shared with the
 * exported-HTML runtime, so keep it dependency-free.
 *
 * Matrix layout: every matrix here is COLUMN-MAJOR, exactly like three.js
 * `Matrix3.fromArray` / `Matrix4.fromArray` expect (element [col * n + row]).
 *
 * Canonical frame C: Z-up, right-handed (CAD convention). Standard views
 * look at C like a CAD tool: front camera at -Y looking +Y (X right, Z up).
 * `basis(p)` maps preset coordinates to C; its columns are the images of the
 * preset's e_x, e_y, e_z expressed in C.
 *
 * - zup-rh (CATIA/NX/Creo/STEP): identity.
 * - ros (REP-103: X forward, Y left, Z up): identity (default unit m). A ROS
 *   model's forward (+X) therefore faces the right-view camera (accepted).
 * - yup-rh (glTF/Maya/SolidWorks): standard Y-up -> Z-up conversion that keeps
 *   X fixed, Rx(+90°) (Blender/CAD). Columns: e_x -> (1,0,0), e_y -> (0,0,1),
 *   e_z -> (0,-1,0). The model's front (+Z) lands on C -Y, facing the front
 *   view camera. det = +1.
 * - yup-lh (Unity: X right, Y up, Z forward, LH): Unity forward (+Z) -> C -Y
 *   so it faces the front camera, up -> +Z. Seen from that camera the model's
 *   own right appears on screen left, so e_x -> (-1,0,0).
 *   Columns: (-1,0,0), (0,0,1), (0,-1,0). det = -1.
 * - zup-lh (Unreal: X forward, Y right, Z up, LH): X kept, Y mirrored.
 *   Columns: (1,0,0), (0,-1,0), (0,0,1). det = -1.
 *
 * All bases are signed permutations (orthonormal), so the inverse is the
 * transpose.
 */

export type FramePreset = "zup-rh" | "yup-rh" | "ros" | "yup-lh" | "zup-lh";
export type Unit = "mm" | "cm" | "m" | "in";
export type Vec3 = readonly number[];

export const FRAME_PRESETS: readonly FramePreset[] = ["zup-rh", "yup-rh", "ros", "yup-lh", "zup-lh"];

export const UNITS: readonly Unit[] = ["mm", "cm", "m", "in"];

/** UI labels (Korean, with the tools that use each convention). */
export const FRAME_LABELS: Readonly<Record<FramePreset, string>> = {
  "zup-rh": "Z-up 오른손 (CATIA/NX/Creo/STEP)",
  "yup-rh": "Y-up 오른손 (glTF/Maya/SolidWorks)",
  ros: "ROS REP-103",
  "yup-lh": "Y-up 왼손 (Unity)",
  "zup-lh": "Z-up 왼손 (Unreal)",
};
/** Short names for the closed toolbar dropdown. */
export const FRAME_SHORT_LABELS: Readonly<Record<FramePreset, string>> = {
  "zup-rh": "Z-up RH",
  "yup-rh": "Y-up RH",
  ros: "ROS",
  "yup-lh": "Y-up LH",
  "zup-lh": "Z-up LH",
};
export const UNIT_LABELS: Readonly<Record<Unit, string>> = { mm: "mm", cm: "cm", m: "m", in: "inch" };

/** A file's source frame and unit ("as-is": take the file values as display-frame values). */
export interface ObjectFrame {
  frame: FramePreset | "as-is";
  unit: Unit | "as-is";
}

/** Millimetres per unit. */
export const UNIT_MM: Readonly<Record<Unit, number>> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

const BASES: Record<FramePreset, number[]> = {
  "zup-rh": [1, 0, 0, 0, 1, 0, 0, 0, 1],
  ros: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  "yup-rh": [1, 0, 0, 0, 0, 1, 0, -1, 0],
  "yup-lh": [-1, 0, 0, 0, 0, 1, 0, -1, 0],
  "zup-lh": [1, 0, 0, 0, -1, 0, 0, 0, 1],
};

/** Column-major 3x3 mapping preset coordinates to the canonical frame C. */
export function basis(p: FramePreset): number[] {
  return BASES[p].slice();
}

/** Determinant of a column-major (or row-major, same value) 3x3. */
export function det3(m: number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[7] * m[5]) -
    m[3] * (m[1] * m[8] - m[7] * m[2]) +
    m[6] * (m[1] * m[5] - m[4] * m[2])
  );
}

function transpose3(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

function multiply3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    }
  }
  return out;
}

/** Column-major 3x3 times vector. */
export function applyMatrix3(m: number[], v: Vec3): number[] {
  return [0, 1, 2].map((r) => m[r] * v[0] + m[3 + r] * v[1] + m[6 + r] * v[2]);
}

/** Embed a column-major 3x3 (scaled by s) into a column-major 4x4. */
function toMatrix4(m: number[], s = 1): number[] {
  return [
    m[0] * s, m[1] * s, m[2] * s, 0,
    m[3] * s, m[4] * s, m[5] * s, 0,
    m[6] * s, m[7] * s, m[8] * s, 0,
    0, 0, 0, 1,
  ];
}

/** Column-major 4x4 product a·b. */
export function multiply4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Transform a point by a column-major 4x4 (affine, w = 1). */
export function applyMatrix4(m: number[], p: Vec3): number[] {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}

/**
 * Column-major 4x4 mapping display-frame coordinates to three.js world
 * (Y-up RH): B_yup⁻¹·B_display. Default display zup-rh sends (0,0,1) to (0,1,0)
 * and C -Y (front) to world +Z, where three's default camera sits.
 */
export function displayRootMatrix(display: FramePreset): number[] {
  return toMatrix4(multiply3(transpose3(BASES["yup-rh"]), BASES[display]));
}

/**
 * Column-major 4x4 (three.js `Matrix4.fromArray` compatible) mapping source
 * coordinates to display coordinates: B_D⁻¹·B_S·(u_S/u_D).
 * `"as-is"` frame means B_S = B_D (no rotation); `"as-is"` unit means no scaling.
 */
export function objectMatrix(
  display: FramePreset,
  displayUnit: Unit,
  source: FramePreset | "as-is",
  sourceUnit: Unit | "as-is",
): number[] {
  const rot = source === "as-is" ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : multiply3(transpose3(BASES[display]), BASES[source]);
  const scale = sourceUnit === "as-is" ? 1 : UNIT_MM[sourceUnit] / UNIT_MM[displayUnit];
  return toMatrix4(rot, scale);
}

/** Point in source coordinates -> display coordinates. */
export function toDisplay(
  p: Vec3,
  display: FramePreset,
  displayUnit: Unit,
  source: FramePreset | "as-is",
  sourceUnit: Unit | "as-is",
): number[] {
  return applyMatrix4(objectMatrix(display, displayUnit, source, sourceUnit), p);
}

/** Point in display coordinates -> source coordinates (inverse of toDisplay). */
export function toSource(
  p: Vec3,
  display: FramePreset,
  displayUnit: Unit,
  source: FramePreset | "as-is",
  sourceUnit: Unit | "as-is",
): number[] {
  if (source === "as-is" && sourceUnit === "as-is") return [p[0], p[1], p[2]];
  // Inverse of B_D⁻¹·B_S·k is B_S⁻¹·B_D·(1/k): swap roles (as-is frame stays as-is).
  const rot = source === "as-is" ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : multiply3(transpose3(BASES[source]), BASES[display]);
  const scale = sourceUnit === "as-is" ? 1 : UNIT_MM[displayUnit] / UNIT_MM[sourceUnit];
  return applyMatrix4(toMatrix4(rot, scale), p);
}
