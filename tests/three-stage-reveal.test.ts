// @vitest-environment happy-dom
// Stage.reveal / setObjectVisible without WebGL: a Stage shell with a stub renderer.
import { expect, test } from "vitest";
import { Group, Object3D } from "three";
import { Stage } from "../src/three/core/stage";

function shell(): Stage {
  const s = Object.create(Stage.prototype) as Stage;
  Object.assign(s, {
    disposed: false,
    pending: 0,
    content: new Group(),
    renderer: { compileAsync: async () => {} },
    render() {},
    updateBounds() {},
    requestRender() {},
  });
  return s;
}

test("reveal keeps objects the user hid while they were pending hidden", async () => {
  const s = shell();
  const a = new Object3D();
  const b = new Object3D();
  s.add(new Group().add(a, b), [a, b]);
  expect([a.visible, b.visible]).toEqual([false, false]);
  s.setObjectVisible(b, false); // user hides b before its batch is uploaded
  expect(b.visible).toBe(false);
  await s.reveal([a, b], [1, 1]);
  expect(a.visible).toBe(true);
  expect(b.visible).toBe(false);
  expect(b.userData.vaPending).toBeUndefined();
  s.setObjectVisible(b, true);
  expect(b.visible).toBe(true);
});

test("setObjectVisible on a pending object that is shown again reveals normally", async () => {
  const s = shell();
  const a = new Object3D();
  s.add(new Group().add(a), [a]);
  s.setObjectVisible(a, false);
  s.setObjectVisible(a, true);
  expect(a.visible).toBe(false); // still pending
  await s.reveal([a], [1]);
  expect(a.visible).toBe(true);
});

test("reveal stops when aborted", async () => {
  const s = shell();
  const objs = [new Object3D(), new Object3D()];
  s.add(new Group().add(...objs), objs);
  const ctrl = new AbortController();
  ctrl.abort();
  await s.reveal(objs, [1, 1], undefined, ctrl.signal);
  expect(objs.map((o) => o.visible)).toEqual([false, false]);
});
