// @vitest-environment happy-dom
// Display preset / per-object source frame on the stage, with three in node (no WebGL): a Stage
// shell carrying the frame fields, then world-space vertex checks.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Group, HemisphereLight, Mesh, PerspectiveCamera, Vector3 } from "three";
import { axisLabelPositions, Stage } from "../src/three/core/stage";
import { FRAME_PRESETS, type FramePreset, type Unit } from "../src/three/core/frames";

function shell(): Stage {
  const s = Object.create(Stage.prototype) as Stage;
  const displayRoot = new Group();
  const content = new Group();
  displayRoot.add(content);
  const camera = new PerspectiveCamera();
  Object.assign(s, {
    disposed: false,
    pending: 0,
    display: "zup-rh",
    displayUnit: "mm",
    displayMatrix: displayRoot.matrix.clone(),
    displayRoot,
    content,
    camera,
    hemi: new HemisphereLight(),
    controls: { target: new Vector3(), update() {} },
    updateBounds() {},
    fitAll() {},
    requestRender() {},
  });
  s.setDisplay("zup-rh", "mm");
  return s;
}

/** A file group holding one mesh with a single vertex at `p` (source coordinates). */
function file(p: [number, number, number]): { group: Group; mesh: Mesh } {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([...p, 0, 0, 0, 0, 0, 0], 3));
  const mesh = new Mesh(g);
  const group = new Group().add(mesh);
  return { group, mesh };
}

function world(s: Stage, mesh: Mesh): number[] {
  s.displayRoot.updateMatrixWorld(true);
  const v = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position") as never, 0).applyMatrix4(mesh.matrixWorld);
  return v.toArray().map((x) => Math.round(x * 1e6) / 1e6 + 0);
}

test("default display (Z-up RH) shows as-is file values with Z up in three's Y-up world", () => {
  const s = shell();
  const { group, mesh } = file([1, 2, 3]);
  s.add(group);
  expect(world(s, mesh)).toEqual([1, 3, -2]);
  expect(s.camera.up.toArray()).toEqual([0, 1, 0]);
});

test("changing the display preset re-maps as-is files (values read in the display frame)", () => {
  const s = shell();
  const { group, mesh } = file([1, 2, 3]);
  s.add(group);
  s.setDisplay("yup-rh", "mm");
  expect(world(s, mesh)).toEqual([1, 2, 3]);
  s.setDisplay("zup-lh", "mm");
  expect(world(s, mesh)).toEqual([1, 3, 2]);
});

test("a file with a source frame lands at the same world place whatever the display preset", () => {
  const s = shell();
  const { group, mesh } = file([1, 2, 3]);
  s.add(group, [], { frame: "yup-rh", unit: "as-is" });
  expect(world(s, mesh)).toEqual([1, 2, 3]);
  for (const d of FRAME_PRESETS) {
    s.setDisplay(d, "mm");
    expect(world(s, mesh)).toEqual([1, 2, 3]);
  }
});

test("setObjectFrame updates the file group's matrix", () => {
  const s = shell();
  const { group, mesh } = file([1, 2, 3]);
  s.add(group);
  s.setObjectFrame(group, { frame: "yup-rh", unit: "as-is" });
  expect(world(s, mesh)).toEqual([1, 2, 3]);
  s.setObjectFrame(group, { frame: "as-is", unit: "as-is" });
  expect(world(s, mesh)).toEqual([1, 3, -2]);
});

test("source and display units scale the file", () => {
  const s = shell();
  const { group, mesh } = file([1, 2, 3]);
  s.add(group, [], { frame: "as-is", unit: "in" });
  expect(world(s, mesh)).toEqual([25.4, 76.2, -50.8]);
  s.setDisplay("zup-rh", "m");
  s.setObjectFrame(group, { frame: "as-is", unit: "mm" });
  expect(world(s, mesh)).toEqual([0.001, 0.003, -0.002]);
  s.setObjectFrame(group, { frame: "as-is", unit: "as-is" }); // as-is: never scaled
  expect(world(s, mesh)).toEqual([1, 3, -2]);
});

test("a group's own transform (e.g. a glTF scene root) is kept under the frame matrix", () => {
  const s = shell();
  const { group, mesh } = file([0, 0, 0]);
  group.position.set(10, 0, 0);
  s.add(group, [], { frame: "yup-rh", unit: "as-is" });
  expect(world(s, mesh)).toEqual([10, 0, 0]);
  s.setDisplay("zup-lh", "mm");
  s.setObjectFrame(group, { frame: "yup-rh", unit: "cm" });
  expect(world(s, mesh)).toEqual([100, 0, 0]);
});

const LH: FramePreset[] = ["yup-lh", "zup-lh"];

test("left-handed presets mirror: matrixWorld det < 0 (RH ones stay > 0)", () => {
  for (const d of FRAME_PRESETS) {
    const s = shell();
    const { group, mesh } = file([1, 2, 3]);
    s.add(group);
    s.setDisplay(d, "mm");
    s.displayRoot.updateMatrixWorld(true);
    expect(Math.sign(mesh.matrixWorld.determinant())).toBe(LH.includes(d) ? -1 : 1);
    // Same for a LH source shown in the default RH display.
    for (const src of LH) {
      s.setDisplay("zup-rh", "mm");
      s.setObjectFrame(group, { frame: src, unit: "as-is" as Unit | "as-is" });
      s.displayRoot.updateMatrixWorld(true);
      expect(mesh.matrixWorld.determinant()).toBeLessThan(0);
    }
  }
});

test("camera up and the hemisphere sky follow the display up axis (world +Y for every preset)", () => {
  const s = shell();
  for (const d of FRAME_PRESETS) {
    s.setDisplay(d, "mm");
    expect(s.camera.up.toArray().map((x) => x + 0)).toEqual([0, 1, 0]);
  }
});

// Mirrored (det < 0) meshes are not culled or lit inside-out: three flips the front-face winding
// from the world matrix determinant, and flat shading derives normals from screen derivatives.
// Guard the three internals we rely on, so an upgrade that changes them fails here.
test("three flips front-face winding for det < 0 meshes", () => {
  const renderer = readFileSync("node_modules/three/src/renderers/WebGLRenderer.js", "utf8");
  expect(renderer).toMatch(/frontFaceCW = \( object\.isMesh && object\.matrixWorld\.determinant(?:Affine)?\(\) < 0 \)/);
  const state = readFileSync("node_modules/three/src/renderers/webgl/WebGLState.js", "utf8");
  expect(state).toMatch(/if \( frontFaceCW \) flipSided = ! flipSided;/);
  const flat = readFileSync("node_modules/three/src/renderers/shaders/ShaderChunk/normal_fragment_begin.glsl.js", "utf8");
  expect(flat).toMatch(/vec3 normal = normalize\( cross\( fdx, fdy \) \);/);
});

test("axis labels sit at the projected axis tips and hide behind the camera", () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const s = shell(); // display zup-rh: display X -> world X, Y -> world -Z, Z -> world Y
  const [x, y, z] = axisLabelPositions(camera, s.displayRoot.matrix, 1, 200, 200);
  expect(x.visible && y.visible && z.visible).toBe(true);
  expect(x.x).toBeGreaterThan(100);
  expect(Math.round(x.y)).toBe(100);
  expect(z.y).toBeLessThan(100); // up on screen
  expect(Math.round(y.x)).toBe(100);
  camera.position.set(0, 0, -5); // looking away from the origin: every tip is behind the camera
  camera.lookAt(0, 0, -10);
  camera.updateMatrixWorld();
  const behind = axisLabelPositions(camera, s.displayRoot.matrix, 1, 200, 200);
  expect(behind.map((p) => p.visible)).toEqual([false, false, false]);
});
