// @vitest-environment happy-dom
// ViewTools with a minimal stage: click selection, dimensions, Escape, the readout, the 5M limits,
// and the section popover.
import { expect, test, vi } from "vitest";
import { Box3Helper, BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { ViewTools, type ToolFile, type ToolStage } from "../src/three/core/view-tools";
import { displayRootMatrix } from "../src/three/core/frames";

function setup(opts: { triangles?: number; scale?: number; sourceUnit?: ToolFile["sourceUnit"] } = {}) {
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
  const stage: ToolStage = {
    content,
    overlay,
    camera,
    displayToWorld,
    canvas: document.createElement("canvas"),
    requestRender: vi.fn(),
    onChange: (fn) => void (change = fn),
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
    displayUnit: () => "mm" as const,
    selected: vi.fn(),
    notice: vi.fn(),
  };
  const tools = new ViewTools(stage, host);
  document.body.append(tools.bar);
  change();
  return { tools, host, stage, box, group };
}

test("a click on a mesh selects its tree node: panel notified, dimensions and a box for the selection", () => {
  const { tools, host, stage } = setup();
  expect(tools.dims.textContent).toBe("전체 2.000 × 2.000 × 2.000 mm · 삼각형 12");
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
  const edges = tools.bar.querySelector<HTMLInputElement>('input[value="edges"]')!;
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

test("the 보기 popover: mode radios and section checkboxes drive modes and planes", () => {
  const { tools, box } = setup();
  const button = tools.bar.querySelector<HTMLButtonElement>(".va3d-view-button")!;
  const menu = tools.bar.querySelector<HTMLElement>(".va3d-view-menu")!;
  expect(menu.hidden).toBe(true);
  button.click();
  expect(menu.hidden).toBe(false);
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
  tools.escape();
  expect(menu.hidden).toBe(true);
});
