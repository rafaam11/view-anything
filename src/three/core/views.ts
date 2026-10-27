/**
 * Camera framing and standard view directions. Pure math, no three.js.
 *
 * Directions are expressed in DISPLAY-frame coordinates (apply
 * `displayRootMatrix` to get three.js world). Semantics follow the canonical
 * frame C of frames.ts (X forward, Y left, Z up): "front" puts the camera on
 * the +forward side looking back at the target, "right" on the right (-Y) side.
 */
import { basis, type FramePreset } from "./frames";

export type StandardView = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";
export const STANDARD_VIEWS: readonly StandardView[] = ["front", "back", "left", "right", "top", "bottom", "iso"];

const S3 = 1 / Math.sqrt(3);

/** Unit vector from target to camera, in canonical frame C. */
const CANONICAL_DIR: Record<StandardView, number[]> = {
  front: [1, 0, 0],
  back: [-1, 0, 0],
  left: [0, 1, 0],
  right: [0, -1, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [S3, -S3, S3], // front-right-top
};

/** C -> preset coordinates: B⁻¹·v = Bᵀ·v (bases are orthonormal). */
function fromCanonical(display: FramePreset, v: number[]): number[] {
  const b = basis(display);
  return [0, 1, 2].map((c) => b[c * 3] * v[0] + b[c * 3 + 1] * v[1] + b[c * 3 + 2] * v[2]);
}

/**
 * Camera distance from the target so a bounding sphere of `radius` fits the
 * view. Uses the tighter of the vertical fov and the horizontal fov derived
 * from `aspect` (width / height). Monotonically increasing in radius.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number): number {
  const halfV = (fovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  return radius / Math.sin(Math.min(halfV, halfH));
}

/** Unit vector from target to camera for a standard view, in display-frame coordinates. */
export function standardViewDirection(name: StandardView, displayFrame: FramePreset): number[] {
  return fromCanonical(displayFrame, CANONICAL_DIR[name]);
}

/** Camera up vector for a standard view, in display-frame coordinates (forward for top/bottom). */
export function standardViewUp(name: StandardView, displayFrame: FramePreset): number[] {
  return fromCanonical(displayFrame, name === "top" || name === "bottom" ? [1, 0, 0] : [0, 0, 1]);
}
