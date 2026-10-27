// UI-thread file loading for the 3D viewer: STL/OBJ/PLY through the parse worker, glTF/GLB
// through GLTFLoader on this thread.
import { LoadingManager, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { platform } from "../platform";
import { fetchWithProgress } from "./io/source";
import { resolveSibling } from "./core/stage-math";
import type { FromWorker, MeshFormat, ParsedFile, Phase, ToWorker } from "./worker/protocol";

export type ProgressFn = (phase: Phase, loaded: number, total: number) => void;

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/** Parse STL/OBJ/PLY in a fresh module worker, terminated afterwards (frees its memory). */
export function loadMeshFile(path: string, format: MeshFormat, onProgress: ProgressFn, signal?: AbortSignal): Promise<ParsedFile> {
  return new Promise<ParsedFile>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const worker = new Worker(new URL("./worker/parse.worker.ts", import.meta.url), { type: "module" });
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
          post({ type: "buffer", id, format, buffer }, [buffer]);
          break;
        }
        case "done":
          finish();
          resolve(msg.file);
          break;
        case "error":
          fail(new Error(msg.message));
          break;
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      if (heard) return fail(new Error(e.message || "worker failed"));
      // The worker never started (e.g. blocked by CSP): parse on this thread instead.
      finish();
      parseHere(path, format, onProgress, signal).then(resolve, reject);
    };
    post({ type: "parse", id, url: platform.assetUrl(path), format });
  });
}

async function parseHere(path: string, format: MeshFormat, onProgress: ProgressFn, signal?: AbortSignal): Promise<ParsedFile> {
  const [{ parseMesh }, buffer] = await Promise.all([
    import("./worker/parse-mesh"),
    fetchWithProgress(platform.assetUrl(path), (l, t) => onProgress("read", l, t), signal, { fallback: () => platform.readFileRaw(path) }),
  ]);
  signal?.throwIfAborted();
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
  signal?.throwIfAborted();
  return gltf.scene;
}
