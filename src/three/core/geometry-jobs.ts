// Heavy per-geometry work (edge lines, BVHs) off the UI thread. Jobs run one at a time through a
// `JobRunner` (a module worker in the app, see ../geometry-worker.ts; inline elsewhere), highest
// priority first. Inputs are copied when a job starts (never at request time, so a long queue does
// not hold copies of every mesh), so the geometry on screen stays usable meanwhile.
import { BufferAttribute, BufferGeometry } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { fastEdgePositions } from "./fast-edges";

export const EDGE_THRESHOLD_DEG = 30;

export interface GeometryInput {
  positions: Float32Array;
  index: Uint16Array | Uint32Array | null;
}

export interface SerializedBvh {
  roots: ArrayBuffer[];
  indirectBuffer: Uint32Array | Uint16Array | null;
}

export type JobKind = "edges" | "bvh";
export type JobResult = Float32Array | SerializedBvh;
/** Runs one job. `signal` aborts it (the geometry was removed); the promise then rejects. */
export type JobRunner = (kind: JobKind, input: GeometryInput, signal?: AbortSignal) => Promise<JobResult>;

/**
 * Job priorities, lower runs first: a BVH someone is pointing at (click, hover) before edge lines
 * before BVHs prebuilt in idle time.
 */
export const PRIORITY = { pick: 0, edges: 1, prebuild: 2 } as const;

/**
 * Without a worker, jobs above this many triangles are refused instead of run on the UI thread
 * (each would freeze it for a noticeable time); the caller turns the feature off for that mesh.
 */
export const INLINE_JOB_TRIANGLES = 50_000;

/** A job refused because it is too big to run on the UI thread. */
export class JobTooLargeError extends Error {
  constructor(triangles: number) {
    super(`geometry job too large to run without a worker (${triangles} triangles)`);
    this.name = "JobTooLargeError";
  }
}

export function abortError(): Error {
  const e = new Error("geometry job aborted");
  e.name = "AbortError";
  return e;
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

function geometryOf(input: GeometryInput): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(input.positions, 3));
  if (input.index) g.setIndex(new BufferAttribute(input.index, 1));
  return g;
}

/** Edge line positions (three's EdgesGeometry at 30°, same output; see fast-edges.ts). */
export function edgePositions(input: GeometryInput, thresholdDeg = EDGE_THRESHOLD_DEG): Float32Array {
  return fastEdgePositions(input.positions, input.index, thresholdDeg);
}

/** An indirect BVH (the geometry's index is left alone), serialized for transfer. */
export function bvhData(input: GeometryInput): SerializedBvh {
  const bvh = new MeshBVH(geometryOf(input), { indirect: true });
  const s = MeshBVH.serialize(bvh, { cloneBuffers: false }) as unknown as SerializedBvh;
  return { roots: s.roots, indirectBuffer: s.indirectBuffer };
}

/** The BVH for `geometry` from data built on a copy of it. */
export function bvhFrom(data: SerializedBvh, geometry: BufferGeometry): MeshBVH {
  return MeshBVH.deserialize({ version: 1, roots: data.roots, index: null, indirectBuffer: data.indirectBuffer } as never, geometry, {
    setIndex: false,
  });
}

/**
 * Copies of a geometry's positions (plain float xyz) and index (transferable). Interleaved,
 * quantized or normalized positions (glTF) are read through the attribute, so the copy holds
 * the same values the GPU draws.
 */
export function inputOf(geometry: BufferGeometry): GeometryInput {
  const attr = geometry.getAttribute("position");
  let positions: Float32Array;
  const plain = (attr as BufferAttribute).isBufferAttribute && attr.array instanceof Float32Array && !attr.normalized && attr.itemSize === 3;
  if (plain) positions = (attr.array as Float32Array).slice(0, attr.count * 3);
  else {
    positions = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      positions[3 * i] = attr.getX(i);
      positions[3 * i + 1] = attr.getY(i);
      positions[3 * i + 2] = attr.getZ(i);
    }
  }
  const src = geometry.index?.array;
  const index = !src ? null : src instanceof Uint16Array || src instanceof Uint32Array ? src.slice() : Uint32Array.from(src as ArrayLike<number>);
  return { positions, index };
}

export function triangles(geometry: BufferGeometry): number {
  return Math.floor((geometry.index ? geometry.index.count : (geometry.getAttribute("position")?.count ?? 0)) / 3);
}

/** Large input copies yield between chunks, including interleaved/normalized glTF accessors. */
export async function inputOfAsync(geometry: BufferGeometry, signal: AbortSignal): Promise<GeometryInput> {
  const attr = geometry.getAttribute("position");
  if (attr.count <= 65_536 && (geometry.index?.count ?? 0) <= 196_608) return inputOf(geometry);
  const positions = new Float32Array(attr.count * 3);
  const plain = (attr as BufferAttribute).isBufferAttribute && attr.array instanceof Float32Array && !attr.normalized && attr.itemSize === 3;
  const pause = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal.aborted) throw abortError();
  };
  for (let start = 0; start < attr.count; start += 65_536) {
    await pause();
    const end = Math.min(start + 65_536, attr.count);
    if (plain) positions.set((attr.array as Float32Array).subarray(start * 3, end * 3), start * 3);
    else for (let i = start; i < end; i++) {
      positions[3 * i] = attr.getX(i);
      positions[3 * i + 1] = attr.getY(i);
      positions[3 * i + 2] = attr.getZ(i);
    }
  }
  const src = geometry.index?.array;
  const index = !src ? null : src instanceof Uint16Array ? new Uint16Array(src.length) : new Uint32Array(src.length);
  if (src && index) for (let start = 0; start < src.length; start += 196_608) {
    await pause();
    index.set(src.subarray(start, start + 196_608), start);
  }
  return { positions, index };
}

export function inputTriangles(input: GeometryInput): number {
  return Math.floor((input.index ? input.index.length : input.positions.length / 3) / 3);
}

/** Runs jobs on the UI thread, one macrotask each (tests, the exported HTML). */
export const inlineRunner: JobRunner = async (kind, input, signal) => {
  await new Promise((r) => setTimeout(r, 0));
  if (signal?.aborted) throw abortError();
  return kind === "edges" ? edgePositions(input) : bvhData(input);
};

/**
 * The fallback when the worker cannot run: small jobs inline, big ones refused with
 * `JobTooLargeError` (see INLINE_JOB_TRIANGLES).
 */
export const guardedInlineRunner: JobRunner = (kind, input, signal) => {
  const n = inputTriangles(input);
  if (n > INLINE_JOB_TRIANGLES) return Promise.reject(new JobTooLargeError(n));
  return inlineRunner(kind, input, signal);
};

interface Job {
  kind: JobKind;
  geometry: BufferGeometry;
  priority: number;
  seq: number;
  resolve: (r: JobResult | null) => void;
  promise: Promise<JobResult | null>;
}

export interface GeometryJobHooks {
  /** A job failed (not cancelled): it is not retried for that geometry. */
  failed?(kind: JobKind, geometry: BufferGeometry, error: unknown): void;
}

export class GeometryJobs {
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private runningAbort: AbortController | null = null;
  private seq = 0;
  private readonly cancelled = new Set<BufferGeometry>();
  private readonly failures: Record<JobKind, WeakSet<BufferGeometry>> = { edges: new WeakSet(), bvh: new WeakSet() };

  constructor(
    private readonly runner: JobRunner = guardedInlineRunner,
    private readonly hooks: GeometryJobHooks = {},
  ) {}

  /** The job failed before for this geometry (requests now resolve null at once). */
  failed(kind: JobKind, geometry: BufferGeometry): boolean {
    return this.failures[kind].has(geometry);
  }

  /**
   * Queue a job (one per geometry and kind; asking again only raises its priority). Resolves with
   * the result, or null if cancelled or failed.
   */
  request(kind: "edges", geometry: BufferGeometry, priority?: number): Promise<Float32Array | null>;
  request(kind: "bvh", geometry: BufferGeometry, priority?: number): Promise<SerializedBvh | null>;
  request(kind: JobKind, geometry: BufferGeometry, priority: number = PRIORITY.prebuild): Promise<JobResult | null> {
    if (this.failed(kind, geometry)) return Promise.resolve(null);
    this.cancelled.delete(geometry);
    const same = (j: Job | null) => j && j.kind === kind && j.geometry === geometry;
    if (same(this.running)) return this.running!.promise;
    const queued = this.queue.find(same);
    if (queued) {
      queued.priority = Math.min(queued.priority, priority);
      return queued.promise;
    }
    let resolve!: (r: JobResult | null) => void;
    const promise = new Promise<JobResult | null>((r) => (resolve = r));
    this.queue.push({ kind, geometry, priority, seq: this.seq++, resolve, promise });
    this.pump();
    return promise;
  }

  /** Drop queued jobs of a geometry; a running one is aborted (the worker restarts) and resolves null. */
  cancel(geometry: BufferGeometry): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].geometry === geometry) this.queue.splice(i, 1)[0].resolve(null);
    }
    if (this.running?.geometry === geometry) {
      this.cancelled.add(geometry);
      this.runningAbort?.abort();
    }
  }

  /** Jobs queued or running. */
  get size(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  private pump(): void {
    if (this.running || this.queue.length === 0) return;
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i];
      const b = this.queue[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    const job = (this.running = this.queue.splice(best, 1)[0]);
    const abort = (this.runningAbort = new AbortController());
    let result: Promise<JobResult>;
    try {
      const large = job.geometry.getAttribute("position").count > 65_536 || (job.geometry.index?.count ?? 0) > 196_608;
      result = large
        ? inputOfAsync(job.geometry, abort.signal).then((input) => this.runner(job.kind, input, abort.signal))
        : this.runner(job.kind, inputOf(job.geometry), abort.signal);
    } catch (e) {
      result = Promise.reject(e);
    }
    result
      .then(
        (r) => (this.cancelled.has(job.geometry) ? null : r),
        (e) => {
          if (this.cancelled.has(job.geometry) || isAbortError(e)) return null;
          if (!(e instanceof JobTooLargeError)) console.warn("view-anything: geometry job failed:", e);
          this.failures[job.kind].add(job.geometry);
          this.hooks.failed?.(job.kind, job.geometry, e);
          return null;
        },
      )
      .then((r) => {
        this.cancelled.delete(job.geometry);
        this.running = null;
        this.runningAbort = null;
        job.resolve(r);
        this.pump();
      });
  }
}
