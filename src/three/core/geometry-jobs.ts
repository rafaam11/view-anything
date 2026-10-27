// Heavy per-geometry work (edge lines, BVHs) off the UI thread. Jobs run one at a time through a
// `JobRunner` (a module worker in the app, see ../geometry-worker.ts; inline elsewhere), highest
// priority first. Inputs are copied when a job starts (never at request time, so a long queue does
// not hold copies of every mesh), so the geometry on screen stays usable meanwhile.
import { BufferAttribute, BufferGeometry, EdgesGeometry } from "three";
import { MeshBVH } from "three-mesh-bvh";

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
export type JobRunner = (kind: JobKind, input: GeometryInput) => Promise<JobResult>;

/** Job priorities: lower runs first. */
export const PRIORITY = { edges: 0, pick: 1, prebuild: 2 } as const;

function geometryOf(input: GeometryInput): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(input.positions, 3));
  if (input.index) g.setIndex(new BufferAttribute(input.index, 1));
  return g;
}

/** Edge line positions (three's EdgesGeometry, 30°) of a triangle mesh. */
export function edgePositions(input: GeometryInput, thresholdDeg = EDGE_THRESHOLD_DEG): Float32Array {
  const edges = new EdgesGeometry(geometryOf(input), thresholdDeg);
  return edges.getAttribute("position").array as Float32Array;
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

/** Copies of a geometry's position and index arrays (transferable). */
export function inputOf(geometry: BufferGeometry): GeometryInput {
  const positions = (geometry.getAttribute("position").array as Float32Array).slice();
  const index = geometry.index ? (geometry.index.array as Uint16Array | Uint32Array).slice() : null;
  return { positions, index };
}

export function triangles(geometry: BufferGeometry): number {
  return Math.floor((geometry.index ? geometry.index.count : (geometry.getAttribute("position")?.count ?? 0)) / 3);
}

/** Runs jobs on the UI thread, one macrotask each (tests, and when no worker can start). */
export const inlineRunner: JobRunner = async (kind, input) => {
  await new Promise((r) => setTimeout(r, 0));
  return kind === "edges" ? edgePositions(input) : bvhData(input);
};

interface Job {
  kind: JobKind;
  geometry: BufferGeometry;
  priority: number;
  seq: number;
  resolve: (r: JobResult | null) => void;
  promise: Promise<JobResult | null>;
}

export class GeometryJobs {
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private seq = 0;
  private readonly cancelled = new Set<BufferGeometry>();

  constructor(private readonly runner: JobRunner = inlineRunner) {}

  /**
   * Queue a job (one per geometry and kind; asking again only raises its priority). Resolves with
   * the result, or null if cancelled or failed.
   */
  request(kind: "edges", geometry: BufferGeometry, priority?: number): Promise<Float32Array | null>;
  request(kind: "bvh", geometry: BufferGeometry, priority?: number): Promise<SerializedBvh | null>;
  request(kind: JobKind, geometry: BufferGeometry, priority: number = PRIORITY.prebuild): Promise<JobResult | null> {
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

  /** Drop queued jobs of a geometry; a running one resolves null. */
  cancel(geometry: BufferGeometry): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].geometry === geometry) this.queue.splice(i, 1)[0].resolve(null);
    }
    if (this.running?.geometry === geometry) this.cancelled.add(geometry);
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
    let result: Promise<JobResult>;
    try {
      result = this.runner(job.kind, inputOf(job.geometry));
    } catch (e) {
      result = Promise.reject(e);
    }
    result
      .then(
        (r) => (this.cancelled.has(job.geometry) ? null : r),
        (e) => {
          console.warn("view-anything: geometry job failed:", e);
          return null;
        },
      )
      .then((r) => {
        this.cancelled.delete(job.geometry);
        this.running = null;
        job.resolve(r);
        this.pump();
      });
  }
}
