import { expect, test, vi } from "vitest";
import { failedAttempt, statusLabel, UpdateController, type UpdateDependencies, type UpdateHandle, type UpdateStatus } from "../src/update/model";

function setup() {
  const statuses: UpdateStatus[] = [];
  const handle: UpdateHandle = {
    version: "0.3.0", close: vi.fn(async () => {}), install: vi.fn(async () => {}),
    download: vi.fn(async (progress) => {
      progress({ event: "Started", data: { contentLength: 100 } });
      progress({ event: "Progress", data: { chunkLength: 55 } });
      progress({ event: "Finished" });
    }),
  };
  const deps: UpdateDependencies = {
    check: vi.fn(async () => handle), publish: (s) => statuses.push(s), approve: vi.fn(async () => true),
    unlock: vi.fn(async () => {}), record: vi.fn(), clearAttempt: vi.fn(), relaunch: vi.fn(async () => {}),
  };
  return { deps, handle, statuses, controller: new UpdateController(deps) };
}

test("checks once, downloads automatically and only installs after explicit approval", async () => {
  const { controller, deps, handle, statuses } = setup();
  await Promise.all([controller.check(), controller.check()]);
  expect(deps.check).toHaveBeenCalledTimes(1);
  expect(statuses.map((s) => s.state)).toEqual(["checking", "available", "downloading", "downloading", "downloading", "downloaded"]);
  expect(statuses).toContainEqual({ state: "downloading", version: "0.3.0", percent: 55 });
  expect(handle.install).not.toHaveBeenCalled();
  await controller.install();
  expect(deps.record).toHaveBeenCalledWith("0.3.0");
  expect(handle.install).toHaveBeenCalledOnce();
  expect(deps.relaunch).toHaveBeenCalledOnce();
  expect(deps.unlock).toHaveBeenCalledOnce();
});

test("cancellation preserves the download and never records or installs", async () => {
  const { controller, deps, handle } = setup();
  deps.approve = async () => false;
  await controller.check();
  await controller.install();
  expect(controller.status.state).toBe("downloaded");
  expect(deps.record).not.toHaveBeenCalled();
  expect(handle.install).not.toHaveBeenCalled();
  expect(deps.unlock).toHaveBeenCalledOnce();
});

test("check and download failures release native resources and allow retry", async () => {
  const { controller, deps, handle } = setup();
  handle.download = async () => { throw new Error("offline"); };
  await controller.check();
  expect(controller.status.state).toBe("error");
  expect(handle.close).toHaveBeenCalledOnce();
  deps.check = async () => null;
  await controller.check();
  expect(controller.status.state).toBe("latest");
});

test("failed install reports failure and releases editor locks", async () => {
  const { controller, deps, handle } = setup();
  handle.install = async () => { throw new Error("installer failed"); };
  await controller.check();
  await controller.install();
  expect(controller.status).toEqual({ state: "installFailed", version: "0.3.0" });
  expect(deps.clearAttempt).toHaveBeenCalledOnce();
  expect(deps.relaunch).not.toHaveBeenCalled();
  expect(deps.unlock).toHaveBeenCalledOnce();
});

test("storage and unlock errors do not leave the updater permanently busy", async () => {
  const { controller, deps, handle } = setup();
  deps.record = () => { throw new Error("storage unavailable"); };
  deps.clearAttempt = () => { throw new Error("storage unavailable"); };
  deps.unlock = vi.fn(async () => { throw new Error("unlock failed"); });
  await controller.check();
  await controller.install();
  expect(controller.status).toEqual({ state: "installFailed", version: "0.3.0" });
  expect(handle.install).not.toHaveBeenCalled();
  deps.unlock = vi.fn(async () => {});
  deps.check = vi.fn(async () => null);
  await controller.check();
  expect(controller.status.state).toBe("latest");
});

test("attempt detection handles success, failure, invalid and stale records", () => {
  const raw = JSON.stringify({ from: "0.2.0", to: "0.3.0" });
  expect(failedAttempt(raw, "0.2.0")).toBe("0.3.0");
  expect(failedAttempt(raw, "0.3.0")).toBeNull();
  expect(failedAttempt(raw, "0.4.0")).toBeNull();
  for (const bad of [null, "broken", "{}", "null", '{"from":1,"to":2}']) expect(failedAttempt(bad, "0.2.0")).toBeNull();
});

test("labels follow the specified Korean updater copy", () => {
  expect(statusLabel({ state: "idle" }, "0.2.0")).toBe("v0.2.0");
  expect(statusLabel({ state: "downloaded", version: "0.3.0" }, "0.2.0")).toBe("0.3.0 업데이트 설치 준비 완료");
  expect(statusLabel({ state: "error" }, "0.2.0")).toBe("업데이트 확인 실패");
});
