// @vitest-environment happy-dom
// ThreeViewer with a fake stage: append queue, remove/abort, visibility, retry rules.
import { beforeEach, expect, test, vi } from "vitest";

const titles: string[] = [];
vi.mock("../src/platform", () => ({
  platform: {
    assetUrl: (p: string) => "asset://" + p,
    readFileRaw: async () => new ArrayBuffer(0),
    setWindowTitle: async (t: string) => void titles.push(t),
  },
}));

type Loader = (path: string, signal?: AbortSignal) => Promise<unknown>;
let loadImpl: Loader;
vi.mock("../src/three/load", () => ({
  loadMeshFile: (path: string, _f: string, _p: unknown, signal?: AbortSignal) => loadImpl(path, signal),
  loadGltfFile: (path: string, _p: unknown, signal?: AbortSignal) => loadImpl(path, signal),
}));

import { Banner, canRetryCoarser, ThreeViewer } from "../src/three/viewer";
import { RetryableCadError, type ParsedFile } from "../src/three/worker/protocol";
import type { Stage } from "../src/three/core/stage";
import type { Mesh, Object3D } from "three";

function parsed(): ParsedFile {
  return {
    tree: { meshes: [], children: [{ name: "A", meshes: [0], children: [] }, { name: "B", meshes: [1], children: [] }] },
    meshes: [0, 1].map(() => ({ name: "", positions: new Float32Array(9) })),
  };
}

function abortable(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
}

let revealGate: Promise<void> | null;
let revealSignals: (AbortSignal | undefined)[];
function fakeStage() {
  return {
    // ViewTools (selection, modes, sections) only listens; no change events from a fake stage.
    canvas: document.createElement("canvas"),
    onChange: vi.fn(),
    requestRender: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    fitAll: vi.fn(),
    setView: vi.fn(),
    setDisplay: vi.fn(),
    setObjectFrame: vi.fn(),
    setObjectVisible: vi.fn((o: Object3D, v: boolean) => void (o.visible = v)),
    reveal: vi.fn(async (_o: unknown, _s: unknown, _step: unknown, signal?: AbortSignal) => {
      revealSignals.push(signal);
      if (revealGate) await revealGate;
    }),
  };
}

let stage: ReturnType<typeof fakeStage>;
let root: HTMLElement;
function make() {
  stage = fakeStage();
  root = document.createElement("div");
  document.body.append(root);
  return new ThreeViewer(stage as unknown as Stage, root);
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const row = (id: string) => root.querySelector<HTMLElement>(`.va3d-node[data-id="${id}"]`);
const status = () => root.querySelector(".va3d-status")!.textContent;
const P = (name: string) => "D:\\m\\" + name;

beforeEach(() => {
  titles.length = 0;
  revealGate = null;
  revealSignals = [];
  loadImpl = async () => parsed();
});

test("accept takes 3D files (queued, one at a time) and returns the rest", async () => {
  const v = make();
  const started: string[] = [];
  let release!: () => void;
  const first = new Promise<void>((r) => (release = r));
  loadImpl = async (p) => {
    started.push(p);
    if (p.endsWith("a.stl")) await first;
    return parsed();
  };
  const left = v.accept([P("a.stl"), P("x.md"), P("b.STEP"), P("y.txt")], { newWindow: false });
  expect(left).toEqual([P("x.md"), P("y.txt")]);
  await settle();
  expect(started).toEqual([P("a.stl")]); // b waits for a
  expect(titles.at(-1)).toBe("a.stl 외 1개");
  release();
  await vi.waitFor(() => expect(v.model.files.map((f) => f.name)).toEqual(["a.stl", "b.STEP"]));
  expect(started).toEqual([P("a.stl"), P("b.STEP")]);
});

test("accept with newWindow takes nothing", () => {
  const v = make();
  expect(v.accept([P("a.stl"), P("x.md")], { newWindow: true })).toEqual([P("a.stl"), P("x.md")]);
});

test("removing a file during GPU upload aborts it, disposes it and leaves no status", async () => {
  const v = make();
  let release!: () => void;
  revealGate = new Promise<void>((r) => (release = r));
  const done = v.load(P("a.stl"));
  await vi.waitFor(() => expect(stage.reveal).toHaveBeenCalled());
  const id = v.model.files[0].id;
  const built = v.objects.get(id)!;
  const disposed = vi.spyOn((built.renderables[0] as Mesh).geometry, "dispose");
  row(id)!.querySelector<HTMLButtonElement>(".va3d-remove")!.click();
  expect(revealSignals[0]?.aborted).toBe(true);
  expect(v.model.files).toEqual([]);
  expect(v.objects.size).toBe(0);
  expect(stage.remove).toHaveBeenCalledWith(built.group);
  expect(disposed).toHaveBeenCalled();
  expect(row(id)).toBeNull();
  release();
  expect(await done).toBeNull();
  expect(status()).toBe("");
  expect(titles.at(-1)).toBe("view-anything");
});

test("an upload aborted by other means also disposes and removes the file", async () => {
  const v = make();
  let release!: () => void;
  revealGate = new Promise<void>((r) => (release = r));
  const done = v.load(P("a.stl"));
  await vi.waitFor(() => expect(stage.reveal).toHaveBeenCalled());
  const id = v.model.files[0].id;
  const group = v.objects.get(id)!.group;
  v.abortAll();
  release();
  expect(await done).toBeNull();
  expect(v.model.files).toEqual([]);
  expect(v.objects.size).toBe(0);
  expect(stage.remove).toHaveBeenCalledWith(group);
  expect(status()).toBe("");
});

test("removing a file that is still being read aborts its load", async () => {
  const v = make();
  let seen: AbortSignal | undefined;
  loadImpl = (_p, signal) => ((seen = signal), abortable(signal));
  const done = v.load(P("big.step"));
  await settle();
  const r = root.querySelector<HTMLElement>(".va3d-node.loading")!;
  expect(r).not.toBeNull();
  r.querySelector<HTMLButtonElement>(".va3d-remove")!.click();
  expect(seen?.aborted).toBe(true);
  expect(await done).toBeNull();
  expect(root.querySelector(".va3d-node")).toBeNull();
  expect(v.model.files).toEqual([]);
  expect(stage.add).not.toHaveBeenCalled();
  expect(root.querySelector<HTMLElement>(".va3d-banner")!.hidden).toBe(true);
});

test("removing a queued file before it starts skips its load", async () => {
  const v = make();
  const started: string[] = [];
  let release!: () => void;
  const first = new Promise<void>((r) => (release = r));
  loadImpl = async (p) => {
    started.push(p);
    if (p.endsWith("a.stl")) await first;
    return parsed();
  };
  v.accept([P("a.stl"), P("b.stl")], { newWindow: false });
  await settle();
  const queued = [...root.querySelectorAll<HTMLElement>(".va3d-node.loading")].at(-1)!;
  queued.querySelector<HTMLButtonElement>(".va3d-remove")!.click();
  release();
  await vi.waitFor(() => expect(v.model.files.map((f) => f.name)).toEqual(["a.stl"]));
  await settle();
  expect(started).toEqual([P("a.stl")]);
  expect(titles.at(-1)).toBe("a.stl");
});

test("the eye hides the node's object through the stage and updates the model", async () => {
  const v = make();
  await v.load(P("a.stl"));
  const id = v.model.files[0].id;
  const child = `${id}/1`;
  row(child)!.querySelector<HTMLButtonElement>(".va3d-eye")!.click();
  expect(v.model.files[0].root.children[1].visible).toBe(false);
  expect(stage.setObjectVisible).toHaveBeenLastCalledWith(v.objects.get(id)!.nodes.get(child), false);
});

test("window title: one file is its name, more is '<first> 외 N개'", async () => {
  const v = make();
  await v.load(P("a.stl"));
  expect(titles.at(-1)).toBe("a.stl");
  await v.load(P("b.stl"));
  await v.load(P("c.stl"));
  expect(titles.at(-1)).toBe("a.stl 외 2개");
  v.remove(v.model.files[0].id);
  expect(titles.at(-1)).toBe("b.stl 외 1개");
});

test("coarser retry is offered only when a coarser setting exists", () => {
  expect(canRetryCoarser(new RetryableCadError("oom", 1000, 5))).toBe(true);
  expect(canRetryCoarser(new RetryableCadError("oom", 1000, 6))).toBe(false); // already at the cap
  expect(canRetryCoarser(new RetryableCadError("oom"))).toBe(false); // size unknown
  expect(canRetryCoarser(new Error("oom"))).toBe(false);
});

test("a worker crash at the cap shows no retry button", async () => {
  const v = make();
  loadImpl = async () => {
    throw new RetryableCadError("worker failed", 1000, 6);
  };
  await v.load(P("a.step"));
  const banner = root.querySelector<HTMLElement>(".va3d-banner")!;
  expect(banner.hidden).toBe(false);
  expect(banner.querySelector(".va3d-banner-action")).toBeNull();
  expect(v.model.files).toEqual([]);
  expect(root.querySelector(".va3d-node")).toBeNull();
});

test("banner text is capped", () => {
  const b = new Banner();
  b.show("x".repeat(5000));
  const text = b.root.querySelector("span")!.textContent!;
  expect(text.length).toBeLessThanOrEqual(301);
  expect(text.endsWith("…")).toBe(true);
});

test("toolbar coordinate dropdowns set the display preset and unit (default Z-up RH, mm)", () => {
  make();
  const frame = root.querySelector<HTMLSelectElement>(".va3d-toolbar select.va3d-display-frame")!;
  const unit = root.querySelector<HTMLSelectElement>(".va3d-toolbar select.va3d-display-unit")!;
  expect(frame.value).toBe("zup-rh");
  expect(unit.value).toBe("mm");
  // Closed select stays short; the full description is the option title and the tooltip.
  expect([...frame.options].map((o) => o.textContent)).toEqual(["Z-up RH", "Y-up RH", "ROS", "Y-up LH", "Z-up LH"]);
  expect(frame.options[0].title).toBe("Z-up 오른손 (CATIA/NX/Creo/STEP)");
  expect(frame.title).toContain("Z-up 오른손 (CATIA/NX/Creo/STEP)");
  expect([...unit.options].map((o) => o.textContent)).toEqual(["mm", "cm", "m", "inch"]);
  frame.focus();
  frame.value = "yup-lh";
  frame.dispatchEvent(new Event("change"));
  expect(stage.setDisplay).toHaveBeenLastCalledWith("yup-lh", "mm");
  expect(document.activeElement).not.toBe(frame); // blurred: F and 1-7 reach the stage again
  expect(frame.title).toContain("Unity");
  unit.value = "m";
  unit.dispatchEvent(new Event("change"));
  expect(stage.setDisplay).toHaveBeenLastCalledWith("yup-lh", "m");
});

test("files are added with their source frame; STEP/IGES are fixed to mm, others as-is", async () => {
  const v = make();
  await v.load(P("a.stl"));
  await v.load(P("b.igs"));
  expect(v.model.files.map((f) => [f.sourceFrame, f.sourceUnit])).toEqual([["as-is", "as-is"], ["as-is", "mm"]]);
  expect(stage.add.mock.calls.map((c) => c[2])).toEqual([{ frame: "as-is", unit: "as-is" }, { frame: "as-is", unit: "mm" }]);
});

test("the ⋯ menu changes a file's source frame through the stage and fits", async () => {
  const v = make();
  const id = (await v.load(P("a.stl")))!;
  stage.fitAll.mockClear();
  v.setFileFrame(id, { frame: "yup-rh", unit: "in" });
  expect(v.model.files[0]).toMatchObject({ sourceFrame: "yup-rh", sourceUnit: "in" });
  expect(stage.setObjectFrame).toHaveBeenCalledWith(v.objects.get(id)!.group, { frame: "yup-rh", unit: "in" });
  // STEP keeps mm whatever is asked.
  const sid = (await v.load(P("b.step")))!;
  v.setFileFrame(sid, { frame: "zup-lh", unit: "m" });
  expect(v.model.files[1]).toMatchObject({ sourceFrame: "zup-lh", sourceUnit: "mm" });
});
