// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { ScenePanel } from "../src/three/core/panel";
import { buildTree, findNode, setVisible, type ParsedTree, type SceneFile, type SceneModel } from "../src/three/core/scene-model";

function sceneFile(id: string, parsed: ParsedTree, name = `${id}.step`): SceneFile {
  return { id, path: `C:/x/${name}`, name, format: "step", sourceFrame: "as-is", sourceUnit: "as-is", root: buildTree(parsed, name, id) };
}

const nested: ParsedTree = {
  meshes: [],
  children: [
    { name: "Asm", meshes: [], children: [{ name: "Sub", meshes: [], children: [{ name: "Deep", meshes: [0], children: [] }] }, { name: "Leaf", meshes: [1], children: [] }] },
    { name: "Bolt", meshes: [2], children: [] },
  ],
};

const node = (panel: ScenePanel, id: string) => panel.root.querySelector<HTMLElement>(`.va3d-node[data-id="${id}"]`);
const btn = (panel: ScenePanel, id: string, cls: string) => node(panel, id)!.querySelector<HTMLButtonElement>(`:scope > .va3d-row > .${cls}`)!;

function setup(files: SceneFile[]) {
  const model: SceneModel = { files };
  const toggle = vi.fn((id: string, v: boolean) => void setVisible(model, id, v));
  const remove = vi.fn();
  const panel = new ScenePanel({ toggle, remove });
  document.body.append(panel.root);
  for (const f of files) panel.addFile(f);
  return { model, panel, toggle, remove };
}

test("renders the file node and its direct children only; deeper nodes render on expand", () => {
  const { panel } = setup([sceneFile("f1", nested)]);
  expect(node(panel, "f1")).not.toBeNull();
  expect(node(panel, "f1/0")).not.toBeNull();
  expect(node(panel, "f1/1")).not.toBeNull();
  expect(node(panel, "f1/0/0")).toBeNull(); // depth 2: not rendered yet
  expect(node(panel, "f1")!.getAttribute("aria-expanded")).toBe("true");
  expect(node(panel, "f1/0")!.getAttribute("aria-expanded")).toBe("false");

  btn(panel, "f1/0", "va3d-twisty").click();
  expect(node(panel, "f1/0")!.getAttribute("aria-expanded")).toBe("true");
  expect(node(panel, "f1/0/0")).not.toBeNull();
  expect(node(panel, "f1/0/1")).not.toBeNull();
  expect(node(panel, "f1/0/0/0")).toBeNull();

  // collapse hides, re-expand does not render twice
  btn(panel, "f1/0", "va3d-twisty").click();
  expect(node(panel, "f1/0")!.querySelector<HTMLElement>(":scope > .va3d-children")!.hidden).toBe(true);
  btn(panel, "f1/0", "va3d-twisty").click();
  expect(panel.root.querySelectorAll('.va3d-node[data-id="f1/0/0"]')).toHaveLength(1);
  // leaves have no twisty
  expect(node(panel, "f1/1")!.querySelector(":scope > .va3d-row > .va3d-twisty")).toBeNull();
});

test("a file with thousands of nodes renders only depth 1 up front", () => {
  const children = Array.from({ length: 3000 }, (_, i) => ({ name: `P${i}`, meshes: [], children: [{ name: "x", meshes: [i], children: [] }] }));
  const { panel } = setup([sceneFile("big", { meshes: [], children })]);
  expect(panel.root.querySelectorAll(".va3d-node")).toHaveLength(1 + 3000);
});

test("names go in as text only", () => {
  const evil = '<img src=x onerror="alert(1)"></script>';
  const { panel } = setup([sceneFile("f1", { meshes: [], children: [{ name: evil, meshes: [0], children: [] }] }, "<b>a</b>.step")]);
  expect(panel.root.querySelector("img, b")).toBeNull();
  expect(node(panel, "f1/0")!.querySelector(".va3d-name")!.textContent).toBe(evil);
  expect(node(panel, "f1")!.querySelector(".va3d-name")!.textContent).toBe("<b>a</b>.step");
});

test("the eye toggles visibility through the handler and stays in sync with the scene model", () => {
  const { model, panel, toggle } = setup([sceneFile("f1", nested)]);
  btn(panel, "f1/1", "va3d-eye").click();
  expect(toggle).toHaveBeenLastCalledWith("f1/1", false);
  expect(findNode(model, "f1/1")!.visible).toBe(false);
  expect(node(panel, "f1/1")!.classList.contains("off")).toBe(true);
  expect(btn(panel, "f1/1", "va3d-eye").getAttribute("aria-pressed")).toBe("false");
  btn(panel, "f1/1", "va3d-eye").click();
  expect(toggle).toHaveBeenLastCalledWith("f1/1", true);
  expect(findNode(model, "f1/1")!.visible).toBe(true);
  expect(node(panel, "f1/1")!.classList.contains("off")).toBe(false);
});

test("a node hidden in the model before it is rendered shows as hidden when expanded", () => {
  const { model, panel } = setup([sceneFile("f1", nested)]);
  setVisible(model, "f1/0/1", false);
  btn(panel, "f1/0", "va3d-twisty").click();
  expect(node(panel, "f1/0/1")!.classList.contains("off")).toBe(true);
});

test("file nodes have a remove button; removeFile drops the row", () => {
  const { panel, remove } = setup([sceneFile("f1", nested), sceneFile("f2", nested)]);
  expect(node(panel, "f1/0")!.querySelector(".va3d-remove")).toBeNull();
  btn(panel, "f2", "va3d-remove").click();
  expect(remove).toHaveBeenCalledWith("f2");
  panel.removeFile("f2");
  expect(node(panel, "f2")).toBeNull();
  expect(panel.names()).toEqual(["f1.step"]);
});

test("a loading file shows a row with remove only, replaced in place when loaded", () => {
  const { panel, remove } = setup([sceneFile("f1", nested)]);
  panel.addLoading("f2", "b.stl");
  panel.addLoading("f3", "c.stl");
  expect(node(panel, "f2")!.classList.contains("loading")).toBe(true);
  expect(node(panel, "f2")!.querySelector(".va3d-eye")).toBeNull();
  expect(panel.names()).toEqual(["f1.step", "b.stl", "c.stl"]);
  btn(panel, "f2", "va3d-remove").click();
  expect(remove).toHaveBeenCalledWith("f2");
  panel.addFile(sceneFile("f2", { meshes: [0], children: [] }, "b.stl"));
  expect(node(panel, "f2")!.classList.contains("loading")).toBe(false);
  expect([...panel.root.querySelectorAll<HTMLElement>(".va3d-tree > .va3d-node")].map((n) => n.dataset.id)).toEqual(["f1", "f2", "f3"]);
});

test("a narrow window (820px or less) collapses the panel, widening expands it again", () => {
  let listener: ((e: { matches: boolean }) => void) | null = null;
  const mql = { matches: true, addEventListener: (_: string, l: (e: { matches: boolean }) => void) => (listener = l), removeEventListener() {} };
  const spy = vi.spyOn(window, "matchMedia").mockImplementation((q: string) => {
    expect(q).toBe("(max-width: 820px)");
    return mql as unknown as MediaQueryList;
  });
  try {
    const { panel } = setup([sceneFile("f1", nested)]);
    expect(panel.root.classList.contains("collapsed")).toBe(true);
    listener!({ matches: false });
    expect(panel.root.classList.contains("collapsed")).toBe(false);
    listener!({ matches: true });
    expect(panel.root.classList.contains("collapsed")).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test("the panel collapses and expands", () => {
  const { panel } = setup([sceneFile("f1", nested)]);
  const head = panel.root.querySelector<HTMLButtonElement>(".va3d-panel-toggle")!;
  head.click();
  expect(panel.root.classList.contains("collapsed")).toBe(true);
  expect(panel.root.querySelector<HTMLElement>(".va3d-tree")!.hidden).toBe(true);
  head.click();
  expect(panel.root.classList.contains("collapsed")).toBe(false);
  expect(panel.root.querySelector<HTMLElement>(".va3d-tree")!.hidden).toBe(false);
});

function setupFrames(files: SceneFile[]) {
  const frame = vi.fn((fileId: string, f: { frame: string; unit: string }) => {
    const file = files.find((x) => x.id === fileId)!;
    file.sourceFrame = f.frame as SceneFile["sourceFrame"];
    file.sourceUnit = f.unit as SceneFile["sourceUnit"];
  });
  const panel = new ScenePanel({ toggle: vi.fn(), remove: vi.fn(), frame });
  document.body.append(panel.root);
  for (const f of files) panel.addFile(f);
  return { panel, frame };
}
const menuOf = (panel: ScenePanel, id: string) => node(panel, id)!.querySelector<HTMLElement>(":scope > .va3d-frame-menu");

test("the file row's ⋯ menu picks the source frame and unit (default 그대로)", () => {
  const f = { ...sceneFile("f1", nested, "a.stl"), format: "stl" };
  const { panel, frame } = setupFrames([f]);
  expect(menuOf(panel, "f1")).toBeNull();
  expect(node(panel, "f1/0")!.querySelector(".va3d-more")).toBeNull(); // file rows only
  btn(panel, "f1", "va3d-more").click();
  const menu = menuOf(panel, "f1")!;
  expect(menu.hidden).toBe(false);
  const [frameSel, unitSel] = [...menu.querySelectorAll("select")];
  expect(menu.textContent).toContain("원본 좌표계");
  expect(menu.textContent).toContain("원본 단위");
  expect(frameSel.value).toBe("as-is");
  expect(unitSel.value).toBe("as-is");
  expect([...frameSel.options].map((o) => o.value)).toEqual(["as-is", "zup-rh", "yup-rh", "ros", "yup-lh", "zup-lh"]);
  expect([...unitSel.options].map((o) => o.value)).toEqual(["as-is", "mm", "cm", "m", "in"]);
  expect(frameSel.options[0].textContent).toBe("그대로");
  frameSel.value = "yup-rh";
  frameSel.dispatchEvent(new Event("change", { bubbles: true }));
  expect(frame).toHaveBeenLastCalledWith("f1", { frame: "yup-rh", unit: "as-is" });
  unitSel.value = "in";
  unitSel.dispatchEvent(new Event("change", { bubbles: true }));
  expect(frame).toHaveBeenLastCalledWith("f1", { frame: "yup-rh", unit: "in" });
  btn(panel, "f1", "va3d-more").click();
  expect(menu.hidden).toBe(true);
  btn(panel, "f1", "va3d-more").click(); // reopens with the current values
  expect(menu.querySelector("select")!.value).toBe("yup-rh");
});

test("STEP/IGES files show their unit fixed as mm", () => {
  const f = { ...sceneFile("f2", nested, "a.step"), sourceUnit: "mm" as const };
  const { panel } = setupFrames([f]);
  btn(panel, "f2", "va3d-more").click();
  const unitSel = menuOf(panel, "f2")!.querySelectorAll("select")[1];
  expect(unitSel.disabled).toBe(true);
  expect(unitSel.value).toBe("mm");
  expect(unitSel.title).toBe("STEP/IGES는 mm로 변환되어 열립니다");
});

test("Escape closes an open ⋯ menu (from inside it or from the ⋯ button); aria-expanded follows", () => {
  const { panel } = setupFrames([{ ...sceneFile("f3", nested, "a.obj"), format: "obj" }]);
  const more = btn(panel, "f3", "va3d-more");
  expect(more.getAttribute("aria-expanded")).toBe("false");
  more.click();
  expect(more.getAttribute("aria-expanded")).toBe("true");
  menuOf(panel, "f3")!.querySelector("select")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(menuOf(panel, "f3")!.hidden).toBe(true);
  expect(more.getAttribute("aria-expanded")).toBe("false");
  more.click();
  more.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(menuOf(panel, "f3")!.hidden).toBe(true);
  expect(more.getAttribute("aria-expanded")).toBe("false");
});

test("clicking a row name selects the node; buttons on the row do not", () => {
  const model: SceneModel = { files: [sceneFile("f1", nested)] };
  const select = vi.fn();
  const panel = new ScenePanel({ toggle: () => {}, remove: () => {}, select });
  document.body.append(panel.root);
  panel.addFile(model.files[0]);
  node(panel, "f1/1")!.querySelector<HTMLElement>(":scope > .va3d-row > .va3d-name")!.click();
  expect(select).toHaveBeenCalledWith("f1/1");
  btn(panel, "f1/1", "va3d-eye").click();
  expect(select).toHaveBeenCalledTimes(1);
});

test("setSelected expands the ancestors, marks the row, and clears the previous one", () => {
  const { panel } = setup([sceneFile("f1", nested)]);
  panel.setSelected("f1/0/0/0");
  const deep = node(panel, "f1/0/0/0")!;
  expect(deep).not.toBeNull();
  expect(deep.classList.contains("selected")).toBe(true);
  expect(deep.getAttribute("aria-selected")).toBe("true");
  expect(node(panel, "f1/0")!.getAttribute("aria-expanded")).toBe("true");
  panel.setSelected("f1/1");
  expect(deep.classList.contains("selected")).toBe(false);
  expect(node(panel, "f1/1")!.classList.contains("selected")).toBe(true);
  panel.setSelected(null);
  expect(panel.root.querySelectorAll(".va3d-node.selected")).toHaveLength(0);
});

test("the selection mark survives a row rebuild (loading row replaced, lazy expand)", () => {
  const model: SceneModel = { files: [sceneFile("f1", nested)] };
  const panel = new ScenePanel({ toggle: () => {}, remove: () => {} });
  document.body.append(panel.root);
  panel.addLoading("f1", "f1.step");
  panel.setSelected("f1");
  panel.addFile(model.files[0]); // replaces the loading row
  expect(node(panel, "f1")!.classList.contains("selected")).toBe(true);
  panel.setSelected("f1/0/1");
  expect(node(panel, "f1/0/1")!.classList.contains("selected")).toBe(true);
});

test("exported-HTML panel (no remove, no frame handler): no × or ⋯ buttons; collapse is scriptable", () => {
  const panel = new ScenePanel({ toggle: vi.fn() });
  document.body.append(panel.root);
  panel.addLoading("f9", "x.stl");
  expect(node(panel, "f9")!.querySelector(".va3d-remove")).toBeNull();
  panel.addFile(sceneFile("f9", nested));
  expect(node(panel, "f9")!.querySelector(".va3d-remove")).toBeNull();
  expect(node(panel, "f9")!.querySelector(".va3d-more")).toBeNull();
  panel.setCollapsed(true);
  expect(panel.collapsed).toBe(true);
  panel.setCollapsed(false);
  expect(panel.collapsed).toBe(false);
});
