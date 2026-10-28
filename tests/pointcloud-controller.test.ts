// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { Group, Matrix4, PerspectiveCamera } from "three";
import type { CloudMeta } from "../src/three/cloud/types";
import type { CloudHost } from "../src/three/cloud/controller";
const mocks = vi.hoisted(() => ({ request: vi.fn(), register: vi.fn(), build: vi.fn(), close: vi.fn(), confirm: vi.fn(), closeGuard: null as null | (() => Promise<boolean>), save: vi.fn(), exists: vi.fn() }));
vi.mock("../src/three/cloud/client", () => ({
  CloudClient: class { job = null; request = mocks.request; register = mocks.register; close = mocks.close; cancel = vi.fn(); }, buildCloud: mocks.build,
}));
vi.mock("../src/platform", () => ({ platform: {
  onCloseRequested: async (fn: () => Promise<boolean>) => { mocks.closeGuard = fn; }, confirmDiscard: mocks.confirm,
  saveDialog: mocks.save, pathExists: mocks.exists, confirmDanger: mocks.confirm,
} }));
import { CloudController } from "../src/three/cloud/controller";
import { updateDirty, approveUpdateUnload } from "../src/update/guard";
const meta: CloudMeta = { id: "c0", revision: 0, count: 2, originalCount: 2, invalid: 0, selected: 0, origin: [0,0,0], bounds: [0,0,0,1,1,1], dirty: false, preview: false, canUndo: false, canRedo: false, editable: true, warning: null, hasRgb: true, hasIntensity: true };
function host(): CloudHost { return {
  stage: { canvas: document.createElement("canvas"), controls: { enabled: true }, camera: new PerspectiveCamera(), displayToWorld: new Matrix4(), requestRender: vi.fn(), onCameraChange: vi.fn() } as unknown as CloudHost["stage"],
  tools: { clipper: { planes: [] } } as unknown as CloudHost["tools"],
  file: () => undefined, built: () => ({ group: new Group(), nodes: new Map(), renderables: [], triangles: 0 }),
  replace: vi.fn(async () => {}), notice: vi.fn(), unit: () => "mm",
}; }
beforeEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); mocks.request.mockResolvedValue({ ...meta }); mocks.build.mockImplementation(async () => ({ group: new Group(), nodes: new Map(), renderables: [], triangles: 0 })); mocks.close.mockResolvedValue(undefined); mocks.confirm.mockResolvedValue(false); });
async function setup() { const h = host(); const c = new CloudController(h, document.body); await c.open("f1", "a.pcd", new AbortController().signal); return { c, h }; }
function click(text: string) { const b = [...document.querySelectorAll("button")].find((b) => b.textContent === text)!; b.click(); }
test("cloud panels open without changing the original and clean close needs no prompt", async () => {
  const { c } = await setup(); expect(c.root.hidden).toBe(false); expect(c.dirty()).toBe(false); expect(await mocks.closeGuard!()).toBe(true); expect(mocks.confirm).not.toHaveBeenCalled();
});
test("registration preview is protected and applied alignment is sent to save", async () => {
  const h = host(), groups = new Map([["f1", new Group()], ["f2", new Group()]]);
  h.file = (id) => ({ id, name: id, sourceFrame: "as-is", sourceUnit: "as-is" } as ReturnType<CloudHost["file"]>);
  h.built = (id) => ({ group: groups.get(id)!, nodes: new Map(), renderables: [], triangles: 0 });
  h.stage.setObjectFrame = (group) => { group.matrixAutoUpdate = false; group.matrix.fromArray(group.userData.vaBase); group.updateMatrixWorld(true); };
  const c = new CloudController(h, document.body);
  await c.open("f1", "a.pcd", new AbortController().signal);
  mocks.request.mockResolvedValueOnce({ ...meta, id: "c1" }); await c.open("f2", "b.pcd", new AbortController().signal);
  const choice = c.root.querySelector<HTMLSelectElement>('[aria-label="처리할 클라우드"]')!; choice.value = "f1"; choice.dispatchEvent(new Event("change"));
  mocks.register.mockResolvedValue({ matrix: new Matrix4().makeTranslation(1, 2, 3).toArray(), pairs: 2, sampledSource: 2, sampledTarget: 2, fitness: 1, rmse: 0, iterations: 2, converged: true });
  click("정합 미리보기"); await vi.waitFor(() => expect(c.hasRegistrationPreview()).toBe(true));
  expect(c.dirty()).toBe(true); expect(c.lockExport()).toBe(false); expect(await c.canRemove("f1")).toBe(false);
  click("정합 적용"); expect(c.hasRegistrationPreview()).toBe(false); expect(c.dirty()).toBe(true);
  mocks.request.mockResolvedValueOnce({ ...meta, revision: 1, preview: true });
  click("선택 부분 남기기"); await vi.waitFor(() => expect(c.entries.get("f1")!.meta.preview).toBe(true)); await vi.waitFor(() => expect(c.isBusy()).toBe(false));
  mocks.request.mockResolvedValueOnce({ ...meta, revision: 2, dirty: true, canUndo: true });
  click("결과 적용"); await vi.waitFor(() => expect(c.entries.get("f1")!.undo.length).toBe(2)); await vi.waitFor(() => expect(c.isBusy()).toBe(false));
  mocks.request.mockResolvedValueOnce({ ...meta, revision: 3, canRedo: true });
  click("실행 취소"); await vi.waitFor(() => expect(c.entries.get("f1")!.undo.length).toBe(1)); await vi.waitFor(() => expect(c.isBusy()).toBe(false));
  click("실행 취소"); await vi.waitFor(() => expect(c.entries.get("f1")!.alignment.equals(new Matrix4())).toBe(true)); expect(c.dirty()).toBe(false);
  click("다시 실행"); await vi.waitFor(() => expect(c.entries.get("f1")!.alignment.elements[12]).toBe(1));
  mocks.request.mockResolvedValueOnce({ ...meta, revision: 4, dirty: true, canUndo: true });
  click("다시 실행"); await vi.waitFor(() => expect(c.entries.get("f1")!.meta.revision).toBe(4)); await vi.waitFor(() => expect(c.isBusy()).toBe(false));
  mocks.save.mockResolvedValue("copy.pcd"); mocks.exists.mockResolvedValue(false); mocks.request.mockResolvedValue({ ...meta });
  click("다른 이름으로 저장…"); await vi.waitFor(() => expect(mocks.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: "save", matrix: new Matrix4().makeTranslation(1,2,3).toArray() }), expect.anything(), expect.any(Function)));
});
test("preview is protected on close/update and only explicit apply makes it the working copy", async () => {
  const { c, h } = await setup(); mocks.request.mockResolvedValue({ ...meta, revision: 1, preview: true, count: 1 });
  click("선택 부분 남기기"); await vi.waitFor(() => expect(h.replace).toHaveBeenCalled());
  expect(c.dirty()).toBe(true); expect(updateDirty()).toBe(true); expect(await mocks.closeGuard!()).toBe(false);
  approveUpdateUnload(true); expect(await mocks.closeGuard!()).toBe(true); approveUpdateUnload(false);
  mocks.request.mockResolvedValue({ ...meta, revision: 2, dirty: true, count: 1, canUndo: true });
  click("결과 적용"); await vi.waitFor(() => expect(c.entries.get("f1")!.meta.dirty).toBe(true));
  expect(mocks.request).toHaveBeenLastCalledWith({ type: "apply" }, expect.objectContaining({ revision: 1 }), expect.any(Function));
});
test("removal asks for discard and doesn't delete the session on cancellation", async () => {
  const { c } = await setup(); c.entries.get("f1")!.meta.dirty = true;
  expect(await c.canRemove("f1")).toBe(false); expect(mocks.close).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(true); expect(await c.canRemove("f1")).toBe(true); c.remove("f1"); expect(mocks.close).toHaveBeenCalledWith("c0"); expect(c.root.hidden).toBe(true);
});
test("failed filtering keeps metadata and current scene", async () => {
  const { c, h } = await setup(); mocks.request.mockRejectedValue(new Error("cancelled")); click("선택 부분 삭제");
  await vi.waitFor(() => expect(h.notice).toHaveBeenCalled()); expect(c.entries.get("f1")!.meta.revision).toBe(0); expect(h.replace).not.toHaveBeenCalled(); expect(c.isBusy()).toBe(false);
});
test("save cancellation doesn't start a write", async () => { await setup(); mocks.save.mockResolvedValue(null); click("다른 이름으로 저장…"); await vi.waitFor(() => expect(mocks.save).toHaveBeenCalled()); expect(mocks.request).toHaveBeenCalledTimes(1); });
test("a failed display after native commit blocks edits/export until retry without recomputing", async () => {
  const { c, h } = await setup();
  mocks.request.mockResolvedValue({ ...meta, revision: 1, preview: true }); mocks.build.mockRejectedValueOnce(new Error("IPC failed"));
  click("선택 부분 남기기"); await vi.waitFor(() => expect(c.entries.get("f1")?.stale).toBe(true));
  await vi.waitFor(() => expect(c.isBusy()).toBe(false));
  expect(c.entries.get("f1")!.meta.revision).toBe(1); expect(c.lockExport()).toBe(false);
  const calls = mocks.request.mock.calls.length;
  click("결과 적용"); expect(mocks.request).toHaveBeenCalledTimes(calls);
  click("화면 다시 표시"); await vi.waitFor(() => expect(c.entries.get("f1")?.stale).toBe(false));
  expect(h.replace).toHaveBeenCalledTimes(1); expect(mocks.request).toHaveBeenCalledTimes(calls);
  expect(c.lockExport()).toBe(false); // an unresolved preview must not be exported
  mocks.request.mockResolvedValue({ ...meta, revision: 2, dirty: true });
  click("결과 적용"); await vi.waitFor(() => expect(c.entries.get("f1")?.meta.preview).toBe(false));
  expect(c.lockExport()).toBe(true); c.unlockExport();
});
test("save dialog locks selection, removal and export until dismissed", async () => {
  const { c } = await setup(); let resolve!: (s: string | null) => void;
  mocks.save.mockReturnValue(new Promise<string | null>((r) => resolve = r));
  click("다른 이름으로 저장…"); expect(c.isBusy()).toBe(true); expect(c.lockExport()).toBe(false);
  expect(await c.canRemove("f1")).toBe(false); resolve(null);
  await vi.waitFor(() => expect(c.isBusy()).toBe(false)); expect(mocks.request).toHaveBeenCalledTimes(1);
});
test("HTML export lock disables mutation until released", async () => {
  const { c } = await setup(); expect(c.lockExport()).toBe(true); click("선택 부분 남기기");
  expect(mocks.request).toHaveBeenCalledTimes(1); expect(await c.canRemove("f1")).toBe(false);
  await expect(c.open("f2", "b.pcd", new AbortController().signal)).rejects.toThrow("진행 중");
  c.unlockExport(); expect(c.isBusy()).toBe(false);
});
test("late abort after the final chunk disposes and closes the unmounted session", async () => {
  const h = host(), c = new CloudController(h, document.body), abort = new AbortController();
  mocks.build.mockImplementationOnce(async () => { abort.abort(); return { group: new Group(), nodes: new Map(), renderables: [], triangles: 0 }; });
  await expect(c.open("f1", "a.pcd", abort.signal)).rejects.toThrow(); expect(c.entries.size).toBe(0); expect(mocks.close).toHaveBeenCalledWith("c0");
});
test("frame changes recompute height mapping from the source-to-world transform", async () => {
  const { c, h } = await setup(); const group = new Group(); group.scale.set(2, 3, 4);
  h.built = () => ({ group, nodes: new Map(), renderables: [], triangles: 0 });
  c.entries.get("f1")!.display.mode = "height";
  await c.framesChanged("f1"); expect(c.entries.get("f1")!.display.height).toEqual([0, 3, 0, 0]);
  expect(c.entries.get("f1")!.display.range).toEqual([0, 3]); expect(h.replace).toHaveBeenCalledTimes(1);
});
