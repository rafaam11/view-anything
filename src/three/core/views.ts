/**
 * Camera framing and standard view directions. Pure math, no three.js.
 *
 * Directions are expressed in DISPLAY-frame coordinates (apply
 * `displayRootMatrix` to get three.js world). Semantics follow CAD convention
 * in the canonical frame C of frames.ts (Z-up RH): front = camera at -Y
 * looking +Y (sees the XZ plane, X right, Z up), back +Y, right +X, left -X,
 * top +Z (screen-up +Y, X right), bottom -Z (screen-up -Y), iso from (+X,-Y,+Z).
 */
import { basis, type FramePreset } from "./frames";

export type StandardView = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";
export const STANDARD_VIEWS: readonly StandardView[] = ["front", "back", "left", "right", "top", "bottom", "iso"];

const S3 = 1 / Math.sqrt(3);

/** Unit vector from target to camera, in canonical frame C. */
const CANONICAL_DIR: Record<StandardView, number[]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [S3, -S3, S3], // front-right-top
};

/** Camera screen-up, in canonical frame C. */
const CANONICAL_UP: Record<StandardView, number[]> = {
  front: [0, 0, 1],
  back: [0, 0, 1],
  left: [0, 0, 1],
  right: [0, 0, 1],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  iso: [0, 0, 1],
};

const MIN_ASPECT = 1e-3;

/** C -> preset coordinates: B⁻¹·v = Bᵀ·v (bases are orthonormal). */
function fromCanonical(display: FramePreset, v: number[]): number[] {
  const b = basis(display);
  return [0, 1, 2].map((c) => b[c * 3] * v[0] + b[c * 3 + 1] * v[1] + b[c * 3 + 2] * v[2]);
}

/**
 * Camera distance from the target so a bounding sphere of `radius` fits the
 * view. Uses the tighter of the vertical fov and the horizontal fov derived
 * from `aspect` (width / height). Monotonically increasing in radius.
 * Negative radius is treated as 0; aspect is clamped to at least 1e-3.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const r = Math.max(0, radius);
  const halfV = (fovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(MIN_ASPECT, aspect));
  return r / Math.sin(Math.min(halfV, halfH));
}

/** Unit vector from target to camera for a standard view, in display-frame coordinates. */
export function standardViewDirection(name: StandardView, displayFrame: FramePreset): number[] {
  return fromCanonical(displayFrame, CANONICAL_DIR[name]);
}

/** Camera screen-up vector for a standard view, in display-frame coordinates. */
export function standardViewUp(name: StandardView, displayFrame: FramePreset): number[] {
  return fromCanonical(displayFrame, CANONICAL_UP[name]);
}
