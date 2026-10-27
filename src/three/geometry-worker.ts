// JobRunner backed by one module worker (edges and BVHs off the UI thread). An aborted job (its
// file was removed) terminates the worker, which restarts with the next job. If the worker cannot
// start or dies, small jobs run inline and big ones are refused (guardedInlineRunner): the UI
// thread is never frozen by a large edge or BVH build.
import { abortError, guardedInlineRunner, type GeometryInput, type JobKind, type JobResult, type JobRunner } from "./core/geometry-jobs";
import GeometryWorker from "./worker/geometry.worker?worker&inline";

export interface WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

const defaultSpawn = (): WorkerLike => new GeometryWorker();

/** `spawn`: worker factory (tests). */
export function workerRunner(spawn: (() => WorkerLike) | null = typeof Worker === "undefined" ? null : defaultSpawn): JobRunner {
  let worker: WorkerLike | null = null;
  let broken = spawn === null;
  let nextId = 1;
  const waiting = new Map<number, { resolve: (r: JobResult) => void; reject: (e: unknown) => void }>();
  const failAll = (e: unknown) => {
    for (const w of waiting.values()) w.reject(e);
    waiting.clear();
  };
  const stop = () => {
    worker?.terminate();
    worker = null;
  };
  const start = (): WorkerLike => {
    const w = spawn!();
    w.onmessage = (e: MessageEvent<{ id: number; result?: JobResult; error?: string }>) => {
      const job = waiting.get(e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.error !== undefined) job.reject(new Error(e.data.error));
      else job.resolve(e.data.result!);
    };
    w.onerror = (e) => {
      console.warn("view-anything: geometry worker failed; big meshes get no edges or cursor readout:", e.message);
      broken = true;
      stop();
      failAll(new Error(e.message || "geometry worker failed"));
    };
    return w;
  };
  return (kind: JobKind, input: GeometryInput, signal?: AbortSignal) => {
    if (broken) return guardedInlineRunner(kind, input, signal);
    if (signal?.aborted) return Promise.reject(abortError());
    try {
      worker ??= start();
    } catch {
      broken = true;
      return guardedInlineRunner(kind, input, signal);
    }
    const id = nextId++;
    const transfer: Transferable[] = [input.positions.buffer];
    if (input.index) transfer.push(input.index.buffer);
    return new Promise<JobResult>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      // Removed mid-job: kill the worker (the job may take seconds) and start afresh next time.
      signal?.addEventListener(
        "abort",
        () => {
          if (!waiting.has(id)) return;
          stop();
          failAll(abortError());
        },
        { once: true },
      );
      worker!.postMessage({ id, kind, input }, transfer);
    });
  };
}
