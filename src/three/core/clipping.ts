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
  /** Slider position as a fraction of the scene range on that axis (0 = min, 1 = max). */
  t: number;
}

/**
 * Section state. `planes` is one array shared by every material (`material.clippingPlanes`):
 * it is mutated in place, so new materials only need the reference once.
 */
export class Clipper {
  readonly planes: Plane[] = [];
  readonly axes: AxisClip[] = AXES.map(() => ({ enabled: false, t: 1 }));
  private readonly own = AXES.map(() => new Plane());
  private min = [0, 0, 0];
  private max = [0, 0, 0];
  private matrix: Matrix4 | null = null;

  /** Scene bounds in display coordinates (slider range). */
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

  set(axis: Axis, change: Partial<AxisClip>): void {
    Object.assign(this.axes[axis], change);
    this.update();
  }

  /** The section value (display coordinates) of an axis. */
  value(axis: Axis): number {
    return this.min[axis] + this.axes[axis].t * (this.max[axis] - this.min[axis]);
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
