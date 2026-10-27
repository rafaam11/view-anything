// Streaming file source. Runs in the UI thread and in Web Workers, so it must not import
// platform.ts or any Tauri module; the caller supplies a raw-IPC fallback instead.

export type ProgressFn = (loaded: number, total: number) => void;

export interface FetchOptions {
  /** Used when the streaming fetch fails (not when it is aborted), e.g. `() => platform.readFileRaw(path)`. */
  fallback?: () => Promise<ArrayBuffer>;
}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (e instanceof Error && e.name === "AbortError") || (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError");
}

async function stream(url: string, onProgress: ProgressFn, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }

  // Preallocate from Content-Length so a large file is not copied chunk by chunk; grow if the
  // header understated the size.
  let buf = new Uint8Array(total || 1 << 16);
  let loaded = 0;
  onProgress(0, total);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > buf.length) {
      const grown = new Uint8Array(Math.max(buf.length * 2, loaded + value.length));
      grown.set(buf.subarray(0, loaded));
      buf = grown;
    }
    buf.set(value, loaded);
    loaded += value.length;
    onProgress(loaded, total > loaded ? total : loaded);
  }
  onProgress(loaded, loaded);
  return loaded === buf.length ? buf.buffer : buf.buffer.slice(0, loaded);
}

/**
 * Read `url` (an asset-protocol URL) as a stream, reporting `(loaded, total)`; `total` is 0
 * while unknown. On failure, falls back to `options.fallback` when given. Aborts always reject.
 */
export async function fetchWithProgress(
  url: string,
  onProgress: ProgressFn,
  signal?: AbortSignal,
  options: FetchOptions = {},
): Promise<ArrayBuffer> {
  try {
    return await stream(url, onProgress, signal);
  } catch (e) {
    if (isAbort(e, signal) || !options.fallback) throw e;
    const buf = await options.fallback();
    signal?.throwIfAborted();
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }
}
