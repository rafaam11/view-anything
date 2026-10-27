// Section planes (X/Y/Z, one per axis) on the display frame. Each enabled axis keeps the part of
// the scene at or below its value (display coordinates); three clips in world space, so planes
// are mapped through the display root matrix. Caps are not filled (non-goal).
import { Plane, Vector3, type Matrix4 } from "three";

export type Axis = 0 | 1 | 2;
export const AXES: readonly Axis[] = [0, 1, 2];
export const AXIS_NAMES = ["X", "Y", "Z"] as const;

/**
 * World plane for "keep display coordinate `axis` <= value": in display coordinates the plane is
 * n = -e_axis, constant = value (three keeps points with n·p + c >= 0), then mapped to world.
 */
export function clipPlane(axis: Axis, value: number, displayToWorld: Matrix4, target = new Plane()): Plane {
  target.normal.set(0, 0, 0).setComponent(axis, -1);
  target.constant = value;
  return target.applyMatrix4(displayToWorld);
}

export interface AxisClip {
  enabled: boolean;
  /**
   * Section position in display coordinates (absolute, so hiding or adding content, which
   * changes the slider range, never moves the plane). null until first enabled.
   */
  value: number | null;
}

/**
 * Section state. `planes` is one array shared by every material (`material.clippingPlanes`):
 * it is mutated in place, so new materials only need the reference once.
 */
export class Clipper {
  readonly planes: Plane[] = [];
  readonly axes: AxisClip[] = AXES.map(() => ({ enabled: false, value: null }));
  private readonly own = AXES.map(() => new Plane());
  private min = [0, 0, 0];
  private max = [0, 0, 0];
  private matrix: Matrix4 | null = null;

  /** Scene bounds in display coordinates (slider range only; values stay put). */
  setRange(min: readonly number[], max: readonly number[]): void {
    this.min = [...min];
    this.max = [...max];
    this.update();
  }

  range(axis: Axis): [number, number] {
    return [this.min[axis], this.max[axis]];
  }

  setDisplayMatrix(displayToWorld: Matrix4): void {
    this.matrix = displayToWorld;
    this.update();
  }

  /** Enable or disable an axis; first enabled at the middle of its range. */
  setEnabled(axis: Axis, enabled: boolean): void {
    const a = this.axes[axis];
    a.enabled = enabled;
    if (enabled && a.value === null) a.value = (this.min[axis] + this.max[axis]) / 2;
    this.update();
  }

  /** Set an axis's position (display coordinates) and enable it. */
  setValue(axis: Axis, value: number): void {
    Object.assign(this.axes[axis], { enabled: true, value });
    this.update();
  }

  /** Set an axis's position from a slider fraction of the current range (0 = min, 1 = max). */
  setFraction(axis: Axis, t: number): void {
    this.setValue(axis, this.min[axis] + t * (this.max[axis] - this.min[axis]));
  }

  /** Slider fraction of an axis's position in the current range, clamped to 0..1. */
  fraction(axis: Axis): number {
    const v = this.axes[axis].value;
    const span = this.max[axis] - this.min[axis];
    if (v === null) return 1;
    if (!(span > 0)) return 0.5;
    return Math.min(1, Math.max(0, (v - this.min[axis]) / span));
  }

  /** The section value (display coordinates) of an axis (range max if never set). */
  value(axis: Axis): number {
    return this.axes[axis].value ?? this.max[axis];
  }

  /** Display unit changed: values are lengths, rescale them by old unit / new unit. */
  scale(factor: number): void {
    for (const a of this.axes) if (a.value !== null) a.value *= factor;
    this.update();
  }

  /** Display frame changed (axes mean other directions now): keep values inside the new range. */
  clampToRange(): void {
    AXES.forEach((axis) => {
      const a = this.axes[axis];
      if (a.value !== null) a.value = Math.min(this.max[axis], Math.max(this.min[axis], a.value));
    });
    this.update();
  }

  active(): boolean {
    return this.planes.length > 0;
  }

  /** Whether a world point is cut away by an enabled section. */
  clipped(p: Vector3): boolean {
    return this.planes.some((plane) => plane.distanceToPoint(p) < 0);
  }

  private update(): void {
    this.planes.length = 0;
    if (!this.matrix) return;
    for (const axis of AXES) {
      if (!this.axes[axis].enabled) continue;
      this.planes.push(clipPlane(axis, this.value(axis), this.matrix, this.own[axis]));
    }
  }
}
