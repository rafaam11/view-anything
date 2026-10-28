import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";

export type NavigationMode = "arcball" | "fly";

/** Shared controls for the app and the offline runtime. */
export class Navigation {
  private readonly arcball: ArcballControls;
  private active = true;
  private modeValue: NavigationMode = "arcball";
  private readonly keys = new Set<string>();
  private frame = 0;
  private last = 0;
  private drag: { x: number; y: number; id: number } | null = null;
  private readonly changed: () => void;

  constructor(private readonly camera: PerspectiveCamera, private readonly canvas: HTMLCanvasElement, changed: () => void) {
    this.changed = changed;
    if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
    this.arcball = new ArcballControls(camera, canvas);
    this.arcball.enableAnimations = false;
    this.arcball.setMouseAction("PAN", 1);
    this.arcball.addEventListener("change", changed);
    canvas.addEventListener("pointerdown", this.down, true);
    canvas.addEventListener("pointermove", this.move, true);
    canvas.addEventListener("pointerup", this.up, true);
    canvas.addEventListener("pointercancel", this.up, true);
    window.addEventListener("keydown", this.keyDown, true);
    window.addEventListener("keyup", this.keyUp, true);
    window.addEventListener("blur", this.clear);
  }
  // three 0.186 exposes target at runtime; the matching @types declaration omits it.
  get target(): Vector3 { return (this.arcball as ArcballControls & { target: Vector3 }).target; }
  get enabled(): boolean { return this.active; }
  set enabled(value: boolean) { this.active = value; this.arcball.enabled = value && this.modeValue === "arcball"; if (!value) this.clear(); }
  set minDistance(value: number) { this.arcball.minDistance = value; }
  get mode(): NavigationMode { return this.modeValue; }
  setMode(mode: NavigationMode): void { this.clear(); this.modeValue = mode; this.arcball.enabled = this.active && mode === "arcball"; this.arcball.update(); }
  update(): void { this.arcball.update(); }
  dispose(): void {
    this.clear(); this.arcball.dispose();
    this.canvas.removeEventListener("pointerdown", this.down, true);
    this.canvas.removeEventListener("pointermove", this.move, true);
    this.canvas.removeEventListener("pointerup", this.up, true);
    this.canvas.removeEventListener("pointercancel", this.up, true);
    window.removeEventListener("keydown", this.keyDown, true);
    window.removeEventListener("keyup", this.keyUp, true);
    window.removeEventListener("blur", this.clear);
  }
  private down = (e: PointerEvent) => {
    if (!this.active || this.modeValue !== "fly" || e.button !== 0) return;
    this.canvas.focus({ preventScroll: true }); this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId); e.preventDefault(); e.stopImmediatePropagation();
  };
  private move = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId || !this.active) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag.x = e.clientX; this.drag.y = e.clientY;
    const distance = Math.max(this.camera.position.distanceTo(this.target), 0.001);
    const yaw = new Quaternion().setFromAxisAngle(this.camera.up.clone().normalize(), -dx * .004);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const pitch = new Quaternion().setFromAxisAngle(right, -dy * .004);
    this.camera.quaternion.premultiply(pitch).premultiply(yaw).normalize();
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.target.copy(this.camera.position).addScaledVector(forward, distance);
    this.changed(); e.preventDefault(); e.stopImmediatePropagation();
  };
  private up = (e: PointerEvent) => { if (this.drag?.id === e.pointerId) this.drag = null; };
  private keyDown = (e: KeyboardEvent) => {
    if (!this.active || this.modeValue !== "fly" || document.activeElement !== this.canvas || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"].includes(e.code)) return;
    e.preventDefault(); e.stopImmediatePropagation(); this.keys.add(e.code);
    if (!this.frame) { this.last = performance.now(); this.frame = requestAnimationFrame(this.tick); }
  };
  private keyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private tick = (now: number) => {
    this.frame = 0;
    if (!this.active || this.modeValue !== "fly" || !this.keys.size) return;
    const dt = Math.min((now - this.last) / 1000, .05); this.last = now;
    const v = new Vector3(Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA")), Number(this.keys.has("KeyE")) - Number(this.keys.has("KeyQ")), Number(this.keys.has("KeyS")) - Number(this.keys.has("KeyW")));
    if (v.lengthSq()) {
      v.normalize().applyQuaternion(this.camera.quaternion).multiplyScalar(Math.max(this.camera.position.distanceTo(this.target), .01) * dt);
      this.camera.position.add(v); this.target.add(v); this.changed();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  private clear = () => { this.keys.clear(); this.drag = null; if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; };
}
