// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";

vi.mock("three/addons/controls/ArcballControls.js", () => ({
  ArcballControls: class {
    target = new Vector3(); enabled = true; minDistance = 0; enableAnimations = false;
    setMouseAction() {} addEventListener() {} update() {} dispose() {}
  },
}));
import { Navigation } from "../src/three/core/navigation";

test("Fly drag changes direction, honors disabled state and retains position", () => {
  const camera = new PerspectiveCamera(); camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0);
  const canvas = document.createElement("canvas"); canvas.setPointerCapture = () => {}; document.body.append(canvas);
  const changed = vi.fn(); const nav = new Navigation(camera, canvas, changed);
  nav.setMode("fly");
  canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 100, clientY: 100 }));
  canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 150, clientY: 110 }));
  expect(changed).toHaveBeenCalled(); expect(nav.target.x).not.toBeCloseTo(0); expect(camera.position.toArray()).toEqual([0, 0, 5]);
  nav.enabled = false; const before = nav.target.clone();
  canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 200, clientY: 130 }));
  expect(nav.target.equals(before)).toBe(true);
  nav.dispose(); canvas.remove();
});
