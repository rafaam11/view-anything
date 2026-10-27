// @vitest-environment happy-dom
// Dimensions (bbox in display units, triangle counts), readout formatting and BVH picking.
import { expect, test } from "vitest";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, HemisphereLight, LineSegments, Mesh, PerspectiveCamera, PlaneGeometry, Vector2, Vector3 } from "three";
import { Stage } from "../src/three/core/stage";
import { decimalsFor, displayBox, formatPoint, formatSize, meshTriangles, Picker } from "../src/three/core/info";

/** A Stage carrying only the frame fields (no WebGL), like tests/three-stage-frames.test.ts. */
function shell(): Stage {
  const s = Object.create(Stage.prototype) as Stage;
  const displayRoot = new Group();
  const content = new Group();
  displayRoot.add(content);
  Object.assign(s, {
    disposed: false,
    pending: 0,
    display: "zup-rh",
    displayUnit: "mm",
    displayMatrix: displayRoot.matrix.clone(),
    displayRoot,
    content,
    camera: new PerspectiveCamera(),
    hemi: new HemisphereLight(),
    controls: { target: new Vector3(), update() {} },
    updateBounds() {},
    fitAll() {},
    requestRender() {},
  });
  s.setDisplay("zup-rh", "mm");
  return s;
}

/** A unit-sized box (1 x 2 x 3 file units) centred at the origin. */
function file(): Group {
  return new Group().add(new Mesh(new BoxGeometry(1, 2, 3)));
}

const size = (s: Stage, o: Group) =>
  displayBox(o, s.displayToWorld)
    .getSize(new Vector3())
    .toArray()
    .map((x) => Math.round(x * 1e6) / 1e6);

test("bbox size is in display units: an inch file shows 25.4x in mm, 2.54x in cm", () => {
  const s = shell();
  const g = file();
  s.add(g, [], { frame: "as-is", unit: "in" });
  expect(size(s, g)).toEqual([25.4, 50.8, 76.2]);
  s.setDisplay("zup-rh", "cm");
  expect(size(s, g)).toEqual([2.54, 5.08, 7.62]);
});

test("bbox size is along display axes: a Y-up source file on the Z-up display swaps Y and Z", () => {
  const s = shell();
  const g = file();
  s.add(g, [], { frame: "yup-rh", unit: "as-is" });
  expect(size(s, g)).toEqual([1, 3, 2]);
  // An LH display keeps the extents positive.
  s.setDisplay("zup-lh", "mm");
  expect(size(s, g)).toEqual([1, 3, 2]);
});

test("displayBox: visibleOnly skips hidden objects; edge overlays never count", () => {
  const s = shell();
  const a = new Mesh(new BoxGeometry(1, 1, 1));
  const b = new Mesh(new BoxGeometry(1, 1, 1));
  b.position.set(10, 0, 0);
  const g = new Group().add(a, b);
  s.add(g);
  const edges = new LineSegments(new BoxGeometry(100, 100, 100));
  edges.userData.vaEdges = true;
  a.add(edges);
  expect(size(s, g)).toEqual([11, 1, 1]);
  b.visible = false;
  expect(displayBox(g, s.displayToWorld, { visibleOnly: true }).getSize(new Vector3()).x).toBeCloseTo(1);
  expect(displayBox(g, s.displayToWorld).getSize(new Vector3()).x).toBeCloseTo(11);
});

test("meshTriangles counts triangle meshes only (not edges, points or lines)", () => {
  const g = new Group();
  const m = new Mesh(new BoxGeometry(1, 1, 1)); // 12 triangles, indexed
  const soup = new BufferGeometry();
  soup.setAttribute("position", new Float32BufferAttribute(new Array(18).fill(0), 3)); // 2 triangles, non-indexed
  const edges = new LineSegments(new BoxGeometry());
  edges.userData.vaEdges = true;
  m.add(edges);
  g.add(m, new Mesh(soup));
  expect(meshTriangles(g)).toBe(14);
});

test("decimalsFor: fewer decimals for bigger scenes", () => {
  expect(decimalsFor(120)).toBe(1);
  expect(decimalsFor(5)).toBe(3);
  expect(decimalsFor(2000)).toBe(0);
  expect(decimalsFor(0.01)).toBe(4);
  expect(decimalsFor(0)).toBe(3);
});

test("formatSize / formatPoint", () => {
  expect(formatSize([120, 45.25, 30], "mm", 1)).toBe("120.0 × 45.3 × 30.0 mm");
  expect(formatSize([1, 2, 3], "in", 2)).toBe("1.00 × 2.00 × 3.00 inch");
  expect(formatPoint([12.34, -4, 7.5], 1)).toBe("X 12.3  Y -4.0  Z 7.5");
  expect(formatPoint([-0.0001, 0, 0], 1)).toBe("X 0.0  Y 0.0  Z 0.0");
});

function pickScene() {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const near = new Mesh(new PlaneGeometry(2, 2));
  near.position.z = 1;
  const far = new Mesh(new PlaneGeometry(2, 2));
  const root = new Group().add(near, far);
  root.updateMatrixWorld(true);
  return { camera, root, near, far };
}

test("Picker: first hit along the ray; BVH is built lazily, only when asked for", () => {
  const { camera, root, near, far } = pickScene();
  const picker = new Picker();
  expect(near.geometry.boundsTree).toBeUndefined();
  const plain = picker.pick(root, camera, new Vector2(0, 0), { bvh: false });
  expect(plain?.object).toBe(near);
  expect(near.geometry.boundsTree).toBeUndefined();
  const hit = picker.pick(root, camera, new Vector2(0, 0), { bvh: true });
  expect(hit?.object).toBe(near);
  expect(hit?.point.z).toBeCloseTo(1);
  expect(near.geometry.boundsTree).toBeDefined();
  // A miss builds nothing for meshes the ray never reaches.
  const other = new Mesh(new PlaneGeometry(1, 1));
  other.position.set(50, 0, 0);
  root.add(other);
  root.updateMatrixWorld(true);
  picker.pick(root, camera, new Vector2(0, 0), { bvh: true });
  expect(other.geometry.boundsTree).toBeUndefined();
  expect(far.geometry.boundsTree).toBeDefined(); // on the ray, behind the first hit
  picker.release(root);
  expect(near.geometry.boundsTree).toBeUndefined();
});

test("Picker: hidden meshes and clipped points are skipped", () => {
  const { camera, root, near, far } = pickScene();
  const picker = new Picker();
  near.visible = false;
  expect(picker.pick(root, camera, new Vector2(0, 0), { bvh: true })?.object).toBe(far);
  near.visible = true;
  // Cut away everything with z > 0.5 (the near plane): the far one is hit through it.
  const hit = picker.pick(root, camera, new Vector2(0, 0), { bvh: true, clipped: (p) => p.z > 0.5 });
  expect(hit?.object).toBe(far);
});
