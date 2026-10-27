// Parse worker: fetches the file itself (streaming, with progress) and parses STL/OBJ/PLY, or
// tessellates STEP/IGES through occt (wasm, imported only for those formats), off the UI thread.
// One worker per file; the UI terminates it afterwards to reclaim memory, wasm heap included.
import { fetchWithProgress } from "../io/source";
import { parseMesh } from "./parse-mesh";
import { isCadFormat, progressThrottle, transferables, type CadFormat, type FromWorker, type ParsedFile, type ToWorker, type WorkerFormat } from "./protocol";

// tsconfig only has the DOM lib; describe the bits of DedicatedWorkerGlobalScope used here.
interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent<ToWorker>) => void): void;
}
const scope = self as unknown as WorkerScope;

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** Thrown for failures that a coarser tessellation may avoid (wasm abort, OOM, occt gave up). */
class Retryable extends Error {
  constructor(message: string, readonly byteLength: number) {
    super(message);
  }
}

/** occt module and helpers; started as soon as a STEP/IGES request arrives, while the file is read. */
function openOcct() {
  return Promise.all([import("./occt"), import("./cad-params"), import("occt-import-js/dist/occt-import-js.wasm?url")]).then(
    async ([occt, params, wasm]) => ({ occt, params, module: await occt.loadOcct(wasm.default) }),
  ).catch((e: unknown) => {
    // Not retryable: the engine itself did not load (wasm fetch blocked, no WebAssembly...).
    throw new Error(`STEP/IGES 엔진(wasm)을 불러오지 못했습니다: ${errorText(e)}`);
  });
}

type Engine = Awaited<ReturnType<typeof openOcct>>;

function tessellate(id: number, engine: Engine, format: CadFormat, buffer: ArrayBuffer, coarser: number): ParsedFile {
  scope.postMessage({ type: "progress", id, phase: "tessellate", loaded: 0, total: 0 });
  try {
    return engine.occt.readCad(engine.module, format, new Uint8Array(buffer), engine.params.occtParams(buffer.byteLength, coarser));
  } catch (e) {
    throw new Retryable(errorText(e), buffer.byteLength);
  }
}

async function parseAndReply(id: number, format: WorkerFormat, buffer: ArrayBuffer, coarser: number, engine: Promise<Engine> | null): Promise<void> {
  let file: ParsedFile;
  if (isCadFormat(format)) {
    file = tessellate(id, await (engine ?? openOcct()), format, buffer, coarser);
  } else {
    scope.postMessage({ type: "progress", id, phase: "parse", loaded: 0, total: 0 });
    file = parseMesh(format, buffer);
  }
  scope.postMessage({ type: "done", id, file }, transferables(file));
}

let engine: Promise<Engine> | null = null;

scope.addEventListener("message", async (e) => {
  const msg = e.data;
  try {
    if (isCadFormat(msg.format) && !engine) {
      engine = openOcct();
      engine.catch(() => {}); // reported when awaited
    }
    if (msg.type === "buffer") {
      await parseAndReply(msg.id, msg.format, msg.buffer, msg.coarser ?? 0, engine);
      return;
    }
    const report = progressThrottle((phase, loaded, total) => scope.postMessage({ type: "progress", id: msg.id, phase, loaded, total }));
    let buffer: ArrayBuffer;
    try {
      buffer = await fetchWithProgress(msg.url, (loaded, total) => report("read", loaded, total));
    } catch (err) {
      // No Tauri IPC in a worker: ask the UI thread to read the file and send the bytes.
      scope.postMessage({ type: "need-buffer", id: msg.id, message: errorText(err) });
      return;
    }
    await parseAndReply(msg.id, msg.format, buffer, msg.coarser ?? 0, engine);
  } catch (err) {
    if (err instanceof Retryable) scope.postMessage({ type: "error", id: msg.id, message: err.message, retryable: true, byteLength: err.byteLength });
    else scope.postMessage({ type: "error", id: msg.id, message: errorText(err) });
  }
});
