// UI-thread file loading for the 3D viewer: STL/OBJ/PLY and STEP/IGES through the parse worker,
// glTF/GLB through GLTFLoader on this thread.
import { LoadingManager, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { platform } from "../platform";
import { fetchWithProgress } from "./io/source";
import { resolveSibling } from "./core/stage-math";
import { disposeObject } from "./core/build-objects";
import { isCadFormat, RetryableCadError, type FromWorker, type ParsedFile, type Phase, type ToWorker, type WorkerFormat } from "./worker/protocol";

export type ProgressFn = (phase: Phase, loaded: number, total: number) => void;

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/** Without a worker, files larger than this are refused instead of parsed on the UI thread. */
export const MAIN_THREAD_PARSE_LIMIT = 32 << 20;

/**
 * Parse STL/OBJ/PLY or tessellate STEP/IGES in a fresh module worker, terminated afterwards
 * (frees its memory, including occt's wasm heap). If the worker cannot start, `onFallback` is
 * called and small STL/OBJ/PLY files are parsed on this thread (STEP/IGES are refused).
 * `coarser`: STEP/IGES retries so far, each one a coarser deflection. STEP/IGES failures that a
 * coarser retry may fix reject with RetryableCadError.
 */
export function loadMeshFile(
  path: string,
  format: WorkerFormat,
  onProgress: ProgressFn,
  signal?: AbortSignal,
  onFallback?: () => void,
  coarser = 0,
): Promise<ParsedFile> {
  const fallback = (why: unknown) => {
    console.warn("view-anything: parse worker unavailable, parsing on the UI thread:", why);
    onFallback?.();
    return parseHere(path, format, onProgress, signal);
  };
  return new Promise<ParsedFile>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let worker: Worker;
    try {
      worker = new Worker(new URL("./worker/parse.worker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      fallback(e).then(resolve, reject);
      return;
    }
    const id = 1;
    let heard = false;
    let settled = false;
    const finish = () => {
      settled = true;
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (e: unknown) => {
      if (settled) return;
      finish();
      reject(e);
    };
    const onAbort = () => fail(abortError());
    signal?.addEventListener("abort", onAbort);
    const post = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

    worker.onmessage = async (e: MessageEvent<FromWorker>) => {
      heard = true;
      const msg = e.data;
      if (settled || msg.id !== id) return;
      switch (msg.type) {
        case "progress":
          onProgress(msg.phase, msg.loaded, msg.total);
          break;
        case "need-buffer": {
          // The worker's streaming fetch failed (asset protocol unavailable?): use raw IPC here.
          onProgress("read", 0, 0);
          let buffer: ArrayBuffer;
          try {
            buffer = await platform.readFileRaw(path);
          } catch (err) {
            fail(err);
            return;
          }
          if (settled) return;
          onProgress("read", buffer.byteLength, buffer.byteLength);
          post({ type: "buffer", id, format, buffer, coarser }, [buffer]);
          break;
        }
        case "done":
          finish();
          resolve(msg.file);
          break;
        case "error":
          fail(msg.retryable ? new RetryableCadError(msg.message, msg.byteLength) : new Error(msg.message));
          break;
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      if (heard) {
        // A worker that dies mid-tessellation has most likely run out of memory.
        const message = e.message || "worker failed";
        return fail(isCadFormat(format) ? new RetryableCadError(message) : new Error(message));
      }
      // The worker never started (e.g. blocked by CSP): parse on this thread instead.
      finish();
      fallback(e.message || e).then(resolve, reject);
    };
    post({ type: "parse", id, url: platform.assetUrl(path), format, coarser });
  });
}

async function parseHere(path: string, format: WorkerFormat, onProgress: ProgressFn, signal?: AbortSignal): Promise<ParsedFile> {
  if (isCadFormat(format)) {
    // occt tessellation is one blocking wasm call (seconds on real parts): never on the UI thread.
    throw new Error("파싱 워커를 시작할 수 없어 STEP/IGES 파일은 열지 않습니다 (UI 멈춤 방지)");
  }
  const [{ parseMesh }, buffer] = await Promise.all([
    import("./worker/parse-mesh"),
    fetchWithProgress(platform.assetUrl(path), (l, t) => onProgress("read", l, t), signal, { fallback: () => platform.readFileRaw(path) }),
  ]);
  signal?.throwIfAborted();
  if (buffer.byteLength > MAIN_THREAD_PARSE_LIMIT) {
    throw new Error(`파싱 워커를 시작할 수 없어 32MB가 넘는 파일은 열지 않습니다 (UI 멈춤 방지, ${(buffer.byteLength / (1 << 20)).toFixed(0)} MB)`);
  }
  onProgress("parse", 0, 0);
  return parseMesh(format, buffer);
}

/**
 * Load glTF/GLB on the UI thread. External .bin files and textures are looked up next to the
 * model through the asset protocol; absolute or out-of-scheme URIs are refused.
 */
export async function loadGltfFile(path: string, onProgress: ProgressFn, signal?: AbortSignal): Promise<Object3D> {
  const data = await fetchWithProgress(platform.assetUrl(path), (l, t) => onProgress("read", l, t), signal, {
    fallback: () => platform.readFileRaw(path),
  });
  signal?.throwIfAborted();
  onProgress("parse", 0, 0);
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url;
    const abs = resolveSibling(path, url);
    // An unresolvable reference fails that one resource (GLTFLoader reports it) instead of reading elsewhere.
    return abs === null ? "about:blank#refused" : platform.assetUrl(abs);
  });
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(data, "");
  if (signal?.aborted) {
    disposeObject(gltf.scene);
    throw abortError();
  }
  return gltf.scene;
}
