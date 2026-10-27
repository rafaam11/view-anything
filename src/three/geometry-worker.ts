// JobRunner backed by one module worker (edges and BVHs off the UI thread). Falls back to the
// inline runner if the worker cannot start or dies.
import { inlineRunner, type GeometryInput, type JobKind, type JobResult, type JobRunner } from "./core/geometry-jobs";

export function workerRunner(): JobRunner {
  let worker: Worker | null = null;
  let broken = typeof Worker === "undefined";
  let nextId = 1;
  const waiting = new Map<number, { resolve: (r: JobResult) => void; reject: (e: unknown) => void }>();
  const failAll = (e: unknown) => {
    for (const w of waiting.values()) w.reject(e);
    waiting.clear();
  };
  const start = (): Worker => {
    const w = new Worker(new URL("./worker/geometry.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; result?: JobResult; error?: string }>) => {
      const job = waiting.get(e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.error !== undefined) job.reject(new Error(e.data.error));
      else job.resolve(e.data.result!);
    };
    w.onerror = (e) => {
      console.warn("view-anything: geometry worker failed, building on the UI thread:", e.message);
      broken = true;
      w.terminate();
      worker = null;
      failAll(new Error(e.message || "geometry worker failed"));
    };
    return w;
  };
  return (kind: JobKind, input: GeometryInput) => {
    if (broken) return inlineRunner(kind, input);
    try {
      worker ??= start();
    } catch (e) {
      broken = true;
      return inlineRunner(kind, input);
    }
    const id = nextId++;
    const transfer: Transferable[] = [input.positions.buffer];
    if (input.index) transfer.push(input.index.buffer);
    return new Promise<JobResult>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker!.postMessage({ id, kind, input }, transfer);
    });
  };
}
