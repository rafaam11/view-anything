// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (e: { payload: any }) => any>(),
  status: { state: "idle" } as any,
  startup: true,
  owner: "w0",
  otherResponds: true,
  confirm: vi.fn(async (_dirty: boolean) => true),
  install: vi.fn(async () => {}),
  check: vi.fn(),
  render: vi.fn(),
  relaunch: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: any) => {
  if (command === "update_context") {
    const startup = mock.startup;
    mock.startup = false;
    return { owner: mock.owner, startup, status: mock.status, windows: ["w0", "w1"] };
  }
  if (command === "update_status") mock.status = args.status;
} }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.2.0" }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "w0", setFocus: async () => {} }) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, cb: any) => { mock.handlers.set(event, cb); return () => {}; },
  emit: async (event: string, payload: any) => {
    await mock.handlers.get(event)?.({ payload });
    if (event === "va-update-probe" && payload.phase !== "unlock" && mock.otherResponds) {
      await mock.handlers.get("va-update-ack")?.({ payload: { id: payload.id, phase: payload.phase, label: "w1", dirty: true, ok: true } });
    }
  },
}));
vi.mock("../src/platform", () => ({ platform: { openExternal: async () => {} } }));
vi.mock("../src/update/badge", () => ({ updateBadge: () => mock.render, confirmRestart: mock.confirm }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mock.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mock.relaunch }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
  mock.handlers.clear(); mock.status = { state: "idle" }; mock.startup = true; mock.owner = "w0"; mock.otherResponds = true;
  mock.confirm.mockResolvedValue(true);
  mock.check.mockResolvedValue({ version: "0.3.0", download: async () => {}, install: mock.install, close: async () => {} });
  localStorage.clear(); document.body.innerHTML = '<main id="app"></main>';
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
async function startAndDownload() {
  const { startUpdater } = await import("../src/update/main");
  await startUpdater();
  await mock.handlers.get("va-update-request")!({ payload: "check" });
}
test("all windows acknowledge before install; other window dirtiness reaches confirmation", async () => {
  await startAndDownload();
  await mock.handlers.get("va-update-request")!({ payload: "install" });
  expect(mock.confirm).toHaveBeenCalledWith(true);
  expect(mock.install).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem("va.update.attempt")!)).toEqual({ from: "0.2.0", to: "0.3.0" });
  expect(document.getElementById("app")!.hasAttribute("inert")).toBe(false);
});
test("cancelling in the owner unlocks every window without installing", async () => {
  mock.confirm.mockResolvedValue(false);
  await startAndDownload();
  await mock.handlers.get("va-update-request")!({ payload: "install" });
  expect(mock.install).not.toHaveBeenCalled();
  expect(localStorage.getItem("va.update.attempt")).toBeNull();
  expect(document.getElementById("app")!.hasAttribute("inert")).toBe(false);
});
test("an unresponsive window prevents restart and releases the freeze after timeout", async () => {
  mock.otherResponds = false;
  await startAndDownload();
  const install = mock.handlers.get("va-update-request")!({ payload: "install" });
  await vi.advanceTimersByTimeAsync(5100);
  await install;
  expect(mock.confirm).not.toHaveBeenCalled();
  expect(mock.install).not.toHaveBeenCalled();
  expect(document.getElementById("app")!.hasAttribute("inert")).toBe(false);
});
test("previous failed attempt is consumed once and shown without automatic check", async () => {
  localStorage.setItem("va.update.attempt", '{"from":"0.2.0","to":"0.3.0"}');
  const { startUpdater } = await import("../src/update/main");
  await startUpdater();
  expect(mock.check).not.toHaveBeenCalled();
  expect(mock.render).toHaveBeenCalledWith({ state: "installFailed", version: "0.3.0" });
  expect(localStorage.getItem("va.update.attempt")).toBeNull();
});
