// @vitest-environment happy-dom
// ViewTools with a minimal stage: click selection, dimensions, Escape, the readout, the 5M limits,
// and the section controls (보기 menu).
import { expect, test, vi } from "vitest";
import { Box3Helper, BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { ViewTools, type ToolFile, type ToolStage } from "../src/three/core/view-tools";
import { displayRootMatrix, type Unit } from "../src/three/core/frames";
import { bvhData, edgePositions, type JobRunner } from "../src/three/core/geometry-jobs";

function setup(opts: { triangles?: number; scale?: number; sourceUnit?: ToolFile["sourceUnit"]; jobRunner?: JobRunner } = {}) {
  const displayToWorld = new Matrix4().fromArray(displayRootMatrix("zup-rh"));
  const displayRoot = new Group();
  displayRoot.matrixAutoUpdate = false;
  displayRoot.matrix.copy(displayToWorld);
  const content = new Group();
  const overlay = new Group();
  displayRoot.add(content, overlay);
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const box = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial());
  const part = new Group().add(box);
  const group = new Group().add(part);
  group.scale.setScalar(opts.scale ?? 1);
  content.add(group);
  displayRoot.updateMatrixWorld(true);

  let change = () => {};
  let cameraChange = () => {};
  const stage: ToolStage = {
    content,
    overlay,
    camera,
    displayToWorld,
    canvas: document.createElement("canvas"),
    requestRender: vi.fn(),
    onChange: (fn) => void (change = fn),
    onCameraChange: (fn) => void (cameraChange = fn),
  };
  const file: ToolFile = {
    id: "f1",
    group,
    nodes: new Map<string, import("three").Object3D>([
      ["f1", group],
      ["f1/0", part],
    ]),
    triangles: opts.triangles ?? 12,
    sourceUnit: opts.sourceUnit ?? "as-is",
  };
  const host = {
    files: () => [file],
    nodeName: (id: string) => (id === "f1/0" ? "Box" : "a.stl"),
    unit: "mm" as Unit,
    displayUnit(): Unit {
      return this.unit;
    },
    jobRunner: opts.jobRunner,
    selected: vi.fn(),
    notice: vi.fn(),
  };
  const tools = new ViewTools(stage, host);
  document.body.append(tools.controls);
  change();
  return { tools, host, stage, box, group, change: () => change(), cameraChange: () => cameraChange() };
}

test("a click on a mesh selects its tree node: panel notified, dimensions and a box for the selection", () => {
  const { tools, host, stage } = setup();
  expect(tools.dims.textContent).toBe("전체 2.000 × 2.000 × 2.000 mm"); // one file: count is in the load status
  tools.click(0.5, 0.5); // canvas centre (happy-dom rect is 0x0)
  expect(host.selected).toHaveBeenLastCalledWith("f1/0");
  expect(tools.dims.textContent).toBe("선택 Box: 2.000 × 2.000 × 2.000 mm · 삼각형 12");
  expect(stage.overlay.children.filter((c) => c instanceof Box3Helper)).toHaveLength(1);
  tools.escape();
  expect(host.selected).toHaveBeenLastCalledWith(null);
  expect(tools.dims.textContent).toMatch(/^전체 /);
  expect(stage.overlay.children).toHaveLength(0);
});

test("a click on empty space clears the selection", () => {
  const { tools, host } = setup();
  tools.select("f1/0");
  tools.click(0, 0.5); // far left edge of the view: misses the box
  expect(host.selected).toHaveBeenLastCalledWith(null);
});

test("cursor readout: display coordinates, plus the source coordinates when they differ", () => {
  const plain = setup();
  const hit = { point: new Vector3(0, 0, 1), object: plain.box } as never;
  // World (0,0,1) is display (0,-1,0) on the Z-up display.
  expect(plain.tools.describe(hit)).toBe("X 0.000  Y -1.000  Z 0.000 mm");
  const inch = setup({ scale: 25.4, sourceUnit: "in" });
  const hit2 = { point: new Vector3(0, 0, 25.4), object: inch.box } as never;
  expect(inch.tools.describe(hit2)).toBe("X 0.00  Y -25.40  Z 0.00 mm (원본: X 0.000  Y -1.000  Z 0.000 inch)");
});

test("above 5M triangles: edges are refused with a notice and the hover readout is off", async () => {
  const { tools, host } = setup({ triangles: 6_000_000 });
  tools.setMode("edges");
  expect(tools.displayMode).toBe("solid");
  const edges = tools.controls.querySelector<HTMLInputElement>('input[value="edges"]')!;
  expect(edges.disabled).toBe(true);
  const canvas = (tools as unknown as { stage: ToolStage }).stage.canvas;
  canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 0.5, clientY: 0.5, buttons: 0 }));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  expect(tools.cursor.textContent).toContain("500만");
  expect(host.notice).not.toHaveBeenCalled(); // edges were never on
});

test("edges on, then the scene grows past 5M: edges go off with a notice", () => {
  let triangles = 12;
  const { tools, host, stage } = setup();
  const file = host.files()[0];
  host.files = () => [{ ...file, triangles }];
  tools.setMode("edges");
  expect(tools.displayMode).toBe("edges");
  triangles = 6_000_000;
  tools.refresh();
  expect(tools.displayMode).toBe("solid");
  expect(host.notice).toHaveBeenCalledOnce();
  expect(stage.content).toBeDefined();
});

test("the 보기 controls: mode radios and section checkboxes drive modes and planes", () => {
  const { tools, box } = setup();
  const menu = tools.controls;
  const xray = menu.querySelector<HTMLInputElement>('input[value="xray"]')!;
  xray.checked = true;
  xray.dispatchEvent(new Event("change"));
  expect((box.material as MeshStandardMaterial).opacity).toBe(0.3);
  const [zCheck] = [...menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].slice(2);
  zCheck.checked = true;
  zCheck.dispatchEvent(new Event("change"));
  expect(tools.clipper.planes).toHaveLength(1);
  expect((box.material as MeshStandardMaterial).clippingPlanes).toBe(tools.clipper.planes);
  const zSlider = menu.querySelectorAll<HTMLInputElement>('input[type="range"]')[2];
  zSlider.value = "500";
  zSlider.dispatchEvent(new Event("input"));
  expect(tools.clipper.value(2)).toBeCloseTo(0); // middle of the box (display z -1..1)
});

test("section state round trip (export -> runtime restore)", () => {
  const a = setup();
  a.tools.clipper.setValue(1, 0.25);
  a.tools.clipper.setValue(2, -0.5);
  a.tools.clipper.setEnabled(2, false);
  const saved = a.tools.sectionState();
  expect(saved).toEqual([
    { enabled: false, value: null },
    { enabled: true, value: 0.25 },
    { enabled: false, value: -0.5 },
  ]);
  const b = setup();
  b.tools.restoreSections(saved);
  expect(b.tools.sectionState()).toEqual(saved);
  expect(b.tools.clipper.planes).toHaveLength(1);
  const checks = b.tools.controls.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect([...checks].map((c) => c.checked)).toEqual([false, true, false]);
});

test("two files: the whole-scene line carries the total triangle count", () => {
  const { tools, host, change } = setup();
  const one = host.files()[0];
  host.files = () => [one, { ...one, id: "f2", group: new Group(), nodes: new Map(), triangles: 30 }];
  change();
  expect(tools.dims.textContent).toBe("전체 2.000 × 2.000 × 2.000 mm · 삼각형 42");
});

test("a click on a big mesh whose BVH is not ready is ignored with a notice, never brute-forced", async () => {
  const pending: (() => void)[] = [];
  const jobRunner: JobRunner = (kind, input) => new Promise((r) => pending.push(() => r(kind === "edges" ? edgePositions(input) : bvhData(input))));
  const { tools, host, box } = setup({ triangles: 6_000_000, jobRunner });
  // Pretend the box is huge: no on-the-spot BVH or raycast for it.
  (tools as unknown as { picker: { opts: { syncTriangles: number } } }).picker.opts.syncTriangles = 0;
  const raycast = vi.spyOn(box, "raycast");
  tools.click(0.5, 0.5);
  expect(host.selected).not.toHaveBeenCalled();
  expect(tools.cursor.textContent).toContain("선택 준비 중");
  expect(raycast).not.toHaveBeenCalled();
  pending.shift()!();
  await vi.waitFor(() => expect(box.geometry.boundsTree).toBeDefined());
  tools.click(0.5, 0.5);
  expect(host.selected).toHaveBeenLastCalledWith("f1/0");
});

test("the readout is re-picked when the camera moves under a still pointer", async () => {
  const { tools, stage, cameraChange } = setup();
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  stage.canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 0.5, clientY: 0.5, buttons: 0 }));
  await frame();
  expect(tools.cursor.textContent).toBe("X 0.000  Y -1.000  Z 0.000 mm");
  stage.camera.position.set(0, 0, -10); // look from behind: the hit is the far face now
  stage.camera.lookAt(0, 0, 0);
  stage.camera.updateMatrixWorld();
  cameraChange();
  await frame();
  expect(tools.cursor.textContent).toBe("X 0.000  Y 1.000  Z 0.000 mm");
});

test("sections keep their position when the range changes and follow a unit change", () => {
  const { tools, host, group, change } = setup();
  const menu = tools.controls;
  const zCheck = menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2];
  zCheck.checked = true;
  zCheck.dispatchEvent(new Event("change"));
  expect(tools.clipper.value(2)).toBeCloseTo(0); // first enabled mid-range
  group.add(new Mesh(new BoxGeometry(2, 2, 2)).translateZ(5)); // display z up to 6: range grows
  change();
  expect(tools.clipper.value(2)).toBeCloseTo(0);
  host.unit = "cm";
  group.scale.setScalar(0.1);
  change();
  expect(tools.clipper.value(2)).toBeCloseTo(0);
  const zSlider = menu.querySelectorAll<HTMLInputElement>('input[type="range"]')[2];
  zSlider.value = "1000";
  zSlider.dispatchEvent(new Event("input"));
  expect(tools.clipper.value(2)).toBeCloseTo(0.6); // top of the range, in cm
  host.unit = "mm";
  group.scale.setScalar(1);
  change();
  expect(tools.clipper.value(2)).toBeCloseTo(6);
});
