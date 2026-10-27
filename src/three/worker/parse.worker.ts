// Mesh parse worker: fetches the file itself (streaming, with progress) and parses STL/OBJ/PLY
// off the UI thread. One worker per file; the UI terminates it afterwards to reclaim memory.
import { fetchWithProgress } from "../io/source";
import { parseMesh } from "./parse-mesh";
import { progressThrottle, transferables, type FromWorker, type MeshFormat, type ToWorker } from "./protocol";

// tsconfig only has the DOM lib; describe the bits of DedicatedWorkerGlobalScope used here.
interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent<ToWorker>) => void): void;
}
const scope = self as unknown as WorkerScope;

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function parseAndReply(id: number, format: MeshFormat, buffer: ArrayBuffer): void {
  scope.postMessage({ type: "progress", id, phase: "parse", loaded: 0, total: 0 });
  const file = parseMesh(format, buffer);
  scope.postMessage({ type: "done", id, file }, transferables(file));
}

scope.addEventListener("message", async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "buffer") {
      parseAndReply(msg.id, msg.format, msg.buffer);
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
    parseAndReply(msg.id, msg.format, buffer);
  } catch (err) {
    scope.postMessage({ type: "error", id: msg.id, message: errorText(err) });
  }
});
