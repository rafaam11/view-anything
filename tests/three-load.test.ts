// @vitest-environment happy-dom
// loadMeshFile against a scripted fake Worker: worker crashes, retryability and abort.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../src/platform", () => ({
  platform: {
    assetUrl: (p: string) => "asset://" + p,
    readFileRaw: async () => new ArrayBuffer(8),
  },
}));

import { loadMeshFile } from "../src/three/load";
import { RetryableCadError, type FromWorker } from "../src/three/worker/protocol";

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  send(msg: FromWorker) {
    this.onmessage?.({ data: msg } as MessageEvent<FromWorker>);
  }
  crash(message = "Out of memory") {
    this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
  }
}

beforeEach(() => vi.stubGlobal("Worker", FakeWorker));
afterEach(() => vi.unstubAllGlobals());

const noop = () => {};

test("a worker crash during tessellation is retryable and carries byteLength and coarser", async () => {
  const p = loadMeshFile("D:/a.step", "step", noop, undefined, undefined, 2);
  const w = FakeWorker.last;
  w.send({ type: "progress", id: 1, phase: "read", loaded: 100, total: 1000 });
  w.send({ type: "progress", id: 1, phase: "tessellate", loaded: 0, total: 0, byteLength: 1000 });
  w.crash();
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(RetryableCadError);
  expect(e.byteLength).toBe(1000);
  expect(e.coarser).toBe(2);
  expect(w.terminated).toBe(true);
});

test("a worker crash while reading is not coarser-retryable", async () => {
  const p = loadMeshFile("D:/a.step", "step", noop);
  const w = FakeWorker.last;
  w.send({ type: "progress", id: 1, phase: "read", loaded: 100, total: 1000 });
  w.crash();
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(Error);
  expect(e).not.toBeInstanceOf(RetryableCadError);
});

test("a worker crash on a mesh format is never retryable", async () => {
  const p = loadMeshFile("D:/a.stl", "stl", noop);
  const w = FakeWorker.last;
  w.send({ type: "progress", id: 1, phase: "parse", loaded: 0, total: 0 });
  w.crash();
  expect(await p.catch((x) => x)).not.toBeInstanceOf(RetryableCadError);
});

test("a retryable worker error message carries the coarser count it was made with", async () => {
  const p = loadMeshFile("D:/a.step", "step", noop, undefined, undefined, 1);
  FakeWorker.last.send({ type: "error", id: 1, message: "Aborted(OOM)", retryable: true, byteLength: 5000 });
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(RetryableCadError);
  expect([e.byteLength, e.coarser]).toEqual([5000, 1]);
});

test("aborting terminates the worker and rejects with AbortError", async () => {
  const ctrl = new AbortController();
  const p = loadMeshFile("D:/a.step", "step", noop, ctrl.signal);
  ctrl.abort();
  const e = await p.catch((x) => x);
  expect(e.name).toBe("AbortError");
  expect(FakeWorker.last.terminated).toBe(true);
});
