// File source for the 3D viewer: parallel HTTP Range reads of the asset protocol. Runs in the UI
// thread and in Web Workers, so it must not import platform.ts or any Tauri module; the caller
// supplies a raw-IPC fallback instead.
//
// Why ranges: Tauri's asset protocol answers a plain GET by reading the whole file into one Vec,
// and wry hands that body to WebView2 through SHCreateMemStream on the host UI thread. For a
// 300 MB file that copy froze the window for ~2 s with no progress. A Range request is capped at
// MAX_LEN = 1000 KiB by tauri 2.12.5 (src/protocol/asset.rs), so each response is small and
// progress is real.

export type ProgressFn = (loaded: number, total: number) => void;

export interface FetchOptions {
  /** Used when the read fails (not when it is aborted), e.g. `() => platform.readFileRaw(path)`. */
  fallback?: () => Promise<ArrayBuffer>;
}

/** Bytes per Range request: tauri's asset protocol MAX_LEN (larger requests come back short). */
export const RANGE_CHUNK = 1000 * 1024;
/** Range requests in flight at once. */
export const RANGE_CONCURRENCY = 4;

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (e instanceof Error && e.name === "AbortError") || (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError");
}

function abortError(): Error {
  return typeof DOMException !== "undefined" ? new DOMException("aborted", "AbortError") : Object.assign(new Error("aborted"), { name: "AbortError" });
}

/** Stream a full (200) response body into one buffer, preallocated from Content-Length. */
async function readBody(res: Response, onProgress: ProgressFn): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get("content-length"));
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }
  // Grow if the header understated the size.
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

interface ContentRange {
  start: number;
  end: number;
  total: number;
}

/** "bytes a-b/total" (total must be known) or "bytes *\/total" (start/end = -1). */
function parseContentRange(value: string | null): ContentRange | null {
  const m = /^bytes (?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(value?.trim() ?? "");
  if (!m) return null;
  return { start: m[1] === undefined ? -1 : Number(m[1]), end: m[2] === undefined ? -1 : Number(m[2]), total: Number(m[3]) };
}

async function getRange(url: string, start: number, end: number, signal: AbortSignal): Promise<Response> {
  return fetch(url, { signal, headers: { Range: `bytes=${start}-${end}` } });
}

/** Validate a 206 for the range starting at `start` and return its bytes with their range. */
async function partial(res: Response, url: string, start: number): Promise<{ bytes: Uint8Array; range: ContentRange }> {
  if (res.status !== 206) throw new Error(`${url}: HTTP ${res.status} for a range request`);
  const range = parseContentRange(res.headers.get("content-range"));
  if (!range || range.start !== start || range.end < range.start) throw new Error(`${url}: unexpected Content-Range ${res.headers.get("content-range")}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length !== range.end - range.start + 1) throw new Error(`${url}: range body has ${bytes.length} bytes, expected ${range.end - range.start + 1}`);
  return { bytes, range };
}

async function ranged(url: string, onProgress: ProgressFn, signal?: AbortSignal): Promise<ArrayBuffer> {
  // Internal controller: cancels sibling requests when one fails; follows the caller's signal.
  const ctl = new AbortController();
  const follow = () => ctl.abort();
  signal?.addEventListener("abort", follow);
  try {
    if (signal?.aborted) throw abortError();
    const first = await getRange(url, 0, RANGE_CHUNK - 1, ctl.signal);
    if (first.status === 200) return await readBody(first, onProgress); // Range ignored
    if (first.status === 416) {
      const r = parseContentRange(first.headers.get("content-range"));
      if (r && r.total === 0) {
        onProgress(0, 0);
        return new ArrayBuffer(0);
      }
      throw new Error(`${url}: HTTP 416`);
    }
    if (!first.ok) throw new Error(`${url}: HTTP ${first.status}`);
    const head = await partial(first, url, 0);
    const total = head.range.total;
    const buf = new Uint8Array(total);
    buf.set(head.bytes, 0);
    let loaded = head.bytes.length;
    onProgress(loaded, total);

    // Each worker takes the next RANGE_CHUNK slot and finishes it, re-requesting the rest of the
    // slot when the server answers short.
    let next = head.range.end + 1;
    const worker = async () => {
      while (next < total) {
        let start = next;
        const end = Math.min(total, start + RANGE_CHUNK) - 1;
        next = end + 1;
        while (start <= end) {
          const { bytes, range } = await partial(await getRange(url, start, end, ctl.signal), url, start);
          if (range.total !== total || range.end > end) throw new Error(`${url}: Content-Range changed`);
          buf.set(bytes, start);
          loaded += bytes.length;
          onProgress(loaded, total);
          start = range.end + 1;
        }
      }
    };
    await Promise.all(Array.from({ length: RANGE_CONCURRENCY }, worker)).catch((e) => {
      ctl.abort();
      throw e;
    });
    return buf.buffer;
  } catch (e) {
    ctl.abort();
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    signal?.removeEventListener("abort", follow);
  }
}

/**
 * Read `url` (an asset-protocol URL) with parallel Range requests, reporting `(loaded, total)`;
 * `total` is 0 while unknown. A server that ignores Range is read as one streamed body. On
 * failure, falls back to `options.fallback` when given. Aborts always reject with AbortError.
 */
export async function fetchWithProgress(
  url: string,
  onProgress: ProgressFn,
  signal?: AbortSignal,
  options: FetchOptions = {},
): Promise<ArrayBuffer> {
  try {
    return await ranged(url, onProgress, signal);
  } catch (e) {
    if (isAbort(e, signal) || !options.fallback) throw e;
    const buf = await options.fallback();
    signal?.throwIfAborted();
    onProgress(buf.byteLength, buf.byteLength);
    return buf;
  }
}
