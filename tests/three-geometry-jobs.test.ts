// Geometry jobs (edges, BVHs) for the worker: results match the UI-thread versions, one job at a
// time by priority, deduplicated, cancellable, inputs copied (the shown geometry stays intact).
import { expect, test } from "vitest";
import { BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, InterleavedBuffer, InterleavedBufferAttribute, Mesh, Ray, Raycaster, Vector3, type Intersection } from "three";
import {
  bvhData,
  bvhFrom,
  edgePositions,
  GeometryJobs,
  guardedInlineRunner,
  inputOf,
  inputOfAsync,
  JobTooLargeError,
  PRIORITY,
  type JobKind,
  type JobRunner,
} from "../src/three/core/geometry-jobs";
import { workerRunner, type WorkerLike } from "../src/three/geometry-worker";

test("edgePositions equals three's EdgesGeometry at 30°", () => {
  const g = new BoxGeometry(1, 2, 3, 2, 2, 2);
  const expected = new EdgesGeometry(g, 30).getAttribute("position").array;
  expect(Array.from(edgePositions(inputOf(g)))).toEqual(Array.from(expected));
});

test("a BVH built on a copy works for the original geometry (indirect: index untouched)", () => {
  const g = new BoxGeometry(2, 2, 2);
  const indexBefore = Array.from(g.index!.array);
  g.boundsTree = bvhFrom(bvhData(inputOf(g)), g);
  expect(Array.from(g.index!.array)).toEqual(indexBefore);
  const mesh = new Mesh(g);
  mesh.updateMatrixWorld();
  const raycaster = new Raycaster();
  raycaster.ray = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
  const hits: Intersection[] = [];
  g.boundsTree.raycastObject3D(mesh, raycaster, hits);
  expect(hits[0].point.z).toBeCloseTo(1);
});

test("inputOf copies: transferring the copy leaves the geometry usable", () => {
  const g = new BoxGeometry();
  const input = inputOf(g);
  expect(input.positions).not.toBe(g.getAttribute("position").array);
  expect(input.index).not.toBe(g.index!.array);
});

test("large input copies yield, preserve data and stop on cancellation", async () => {
  const g = new BufferGeometry();
  const p = new Float32Array(70_000 * 3);
  p[p.length - 1] = 42;
  g.setAttribute("position", new BufferAttribute(p, 3));
  const abort = new AbortController();
  let yielded = false;
  setTimeout(() => { yielded = true; }, 0);
  const result = await inputOfAsync(g, abort.signal);
  expect(yielded).toBe(true);
  expect(result.positions[result.positions.length - 1]).toBe(42);
  expect(result.positions).not.toBe(p);
  const pending = inputOfAsync(g, abort.signal);
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

function manual() {
  const started: [JobKind, number][] = [];
  const finish: (() => void)[] = [];
  const runner: JobRunner = (kind, input) => {
    started.push([kind, input.positions.length]);
    return new Promise((resolve) => finish.push(() => resolve(kind === "edges" ? new Float32Array(1) : bvhData(input))));
  };
  const step = async () => {
    finish.shift()!();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { runner, started, step };
}

test("one job at a time, highest priority first (pick, edges, prebuild); asking again dedupes and can raise priority", async () => {
  const { runner, started, step } = manual();
  const jobs = new GeometryJobs(runner);
  const [a, b, c] = [new BoxGeometry(), new BoxGeometry(1, 1, 1, 2), new BoxGeometry(1, 1, 1, 3)];
  void jobs.request("bvh", a, PRIORITY.prebuild); // starts at once
  void jobs.request("bvh", b, PRIORITY.prebuild);
  void jobs.request("bvh", c, PRIORITY.prebuild);
  const again = jobs.request("bvh", c, PRIORITY.pick); // same job, now first of all
  void jobs.request("edges", b, PRIORITY.edges); // edges before prebuilt BVHs
  expect(jobs.size).toBe(4);
  expect(started).toHaveLength(1);
  await step();
  await step();
  await step();
  await step();
  const sizes = (g: BoxGeometry) => g.getAttribute("position").array.length;
  expect(started).toEqual([
    ["bvh", sizes(a)],
    ["bvh", sizes(c)],
    ["edges", sizes(b)],
    ["bvh", sizes(b)],
  ]);
  expect(await again).not.toBeNull();
  expect(jobs.size).toBe(0);
});

test("cancel: queued jobs resolve null without running; a running one resolves null", async () => {
  const { runner, started, step } = manual();
  const jobs = new GeometryJobs(runner);
  const [a, b] = [new BoxGeometry(), new BoxGeometry()];
  const running = jobs.request("edges", a);
  const queued = jobs.request("edges", b);
  jobs.cancel(b);
  jobs.cancel(a);
  expect(await queued).toBeNull();
  await step();
  expect(await running).toBeNull();
  expect(started).toHaveLength(1);
});

test("a failing runner resolves null and the queue goes on", async () => {
  let n = 0;
  const jobs = new GeometryJobs(async (kind, input) => {
    if (n++ === 0) throw new Error("worker died");
    return kind === "edges" ? edgePositions(input) : bvhData(input);
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect(await jobs.request("edges", new BoxGeometry())).toBeNull();
    expect(await jobs.request("edges", new BoxGeometry())).toBeInstanceOf(Float32Array);
  } finally {
    console.warn = warn;
  }
});

test("inputOf reads interleaved and normalized (quantized glTF) positions as plain floats", () => {
  const box = new BoxGeometry(2, 4, 6);
  const plain = Array.from(box.getAttribute("position").array);
  const n = plain.length / 3;
  // Interleaved: xyz + one padding float per vertex.
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) data.set(plain.slice(3 * i, 3 * i + 3), 4 * i);
  const inter = new BufferGeometry();
  inter.setAttribute("position", new InterleavedBufferAttribute(new InterleavedBuffer(data, 4), 3, 0));
  inter.setIndex(box.index!.clone());
  expect(Array.from(inputOf(inter).positions)).toEqual(plain);
  // Normalized int16 (KHR_mesh_quantization).
  const q = new BufferGeometry();
  q.setAttribute("position", new BufferAttribute(Int16Array.from(plain.map((v) => (v / 3) * 32767)), 3, true));
  const back = inputOf(q).positions;
  back.forEach((v, i) => expect(v * 3).toBeCloseTo(plain[i], 3));
  // A Uint8 index becomes a Uint32 one.
  const u8 = new BufferGeometry();
  u8.setAttribute("position", box.getAttribute("position"));
  u8.setIndex(new BufferAttribute(Uint8Array.from(box.index!.array as Uint16Array), 1));
  expect(inputOf(u8).index).toBeInstanceOf(Uint32Array);
});

test("cancelling a running job aborts it through the runner's signal; the queue goes on", async () => {
  const signals: AbortSignal[] = [];
  const runner: JobRunner = (kind, input, signal) =>
    new Promise((resolve, reject) => {
      signals.push(signal!);
      if (signals.length > 1) return resolve(edgePositions(input));
      signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  const jobs = new GeometryJobs(runner);
  const [a, b] = [new BoxGeometry(), new BoxGeometry()];
  const running = jobs.request("edges", a);
  const next = jobs.request("edges", b);
  jobs.cancel(a);
  expect(signals[0].aborted).toBe(true);
  expect(await running).toBeNull();
  expect(await next).toBeInstanceOf(Float32Array);
  expect(jobs.failed("edges", a)).toBe(false); // cancelled, not failed
});

test("a failed job is not retried for that geometry and is reported once", async () => {
  let runs = 0;
  const failed: JobKind[] = [];
  const jobs = new GeometryJobs(
    async () => {
      runs++;
      throw new JobTooLargeError(1e6);
    },
    { failed: (kind) => failed.push(kind) },
  );
  const g = new BoxGeometry();
  expect(await jobs.request("bvh", g)).toBeNull();
  expect(jobs.failed("bvh", g)).toBe(true);
  expect(await jobs.request("bvh", g, PRIORITY.pick)).toBeNull();
  expect(runs).toBe(1);
  expect(failed).toEqual(["bvh"]);
  expect(jobs.failed("edges", g)).toBe(false);
});

test("without a worker, big jobs are refused instead of run on the UI thread", async () => {
  const small = inputOf(new BoxGeometry());
  expect(await guardedInlineRunner("edges", small)).toBeInstanceOf(Float32Array);
  const big = { positions: new Float32Array(9 * 50_001), index: null };
  await expect(guardedInlineRunner("bvh", big)).rejects.toBeInstanceOf(JobTooLargeError);
  // No Worker at all (spawn null): the same guard.
  await expect(workerRunner(null)("edges", big)).rejects.toBeInstanceOf(JobTooLargeError);
});

class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: { id: number; kind: JobKind }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(message: { id: number; kind: JobKind }): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(id: number, result: unknown): void {
    this.onmessage?.({ data: { id, result } } as MessageEvent);
  }
}

test("worker runner: an aborted job terminates the worker and the next job gets a fresh one", async () => {
  FakeWorker.all = [];
  const run = workerRunner(() => new FakeWorker());
  const abort = new AbortController();
  const first = run("edges", inputOf(new BoxGeometry()), abort.signal);
  expect(FakeWorker.all).toHaveLength(1);
  abort.abort();
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  expect(FakeWorker.all[0].terminated).toBe(true);
  const second = run("edges", inputOf(new BoxGeometry()));
  expect(FakeWorker.all).toHaveLength(2);
  const w = FakeWorker.all[1];
  w.reply(w.posted[0].id, new Float32Array(6));
  expect(await second).toBeInstanceOf(Float32Array);
});

test("worker runner: after the worker dies, big jobs are refused, small ones run inline", async () => {
  FakeWorker.all = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    const run = workerRunner(() => new FakeWorker());
    const pending = run("bvh", inputOf(new BoxGeometry()));
    FakeWorker.all[0].onerror?.({ message: "boom" } as ErrorEvent);
    await expect(pending).rejects.toThrow("boom");
    await expect(run("edges", { positions: new Float32Array(9 * 60_000), index: null })).rejects.toBeInstanceOf(JobTooLargeError);
    expect(await run("edges", inputOf(new BoxGeometry()))).toBeInstanceOf(Float32Array);
    expect(FakeWorker.all).toHaveLength(1);
  } finally {
    console.warn = warn;
  }
});
