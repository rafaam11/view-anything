import { afterEach, expect, test, vi } from "vitest";
import { fetchWithProgress, RANGE_CHUNK } from "../src/three/io/source";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Byte equality without vitest deep-diffing megabytes. */
function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const data = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);

interface FakeOptions {
  /** Longest body the server sends per range (Tauri caps at 1000 KiB). */
  cap?: number;
  /** Called before each response; may throw or delay. */
  before?: (call: number, init?: RequestInit) => void | Promise<void>;
  /** Override a response for a given call. */
  override?: (call: number, start: number, end: number) => Response | null;
}

/** Range-capable fake of the Tauri asset protocol. Records requested ranges and peak concurrency. */
function rangeServer(file: Uint8Array, opts: FakeOptions = {}) {
  const requested: string[] = [];
  let inFlight = 0;
  let peak = 0;
  let call = 0;
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const n = call++;
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      await opts.before?.(n, init);
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      const range = new Headers(init?.headers).get("range");
      requested.push(range ?? "none");
      if (!range) return new Response(file.slice(), { status: 200, headers: { "content-length": String(file.length) } });
      const m = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const start = Number(m[1]);
      if (file.length === 0 || start >= file.length) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.length}` } });
      }
      const end = Math.min(Number(m[2]), file.length - 1, start + (opts.cap ?? Infinity) - 1);
      const custom = opts.override?.(n, start, end);
      if (custom) return custom;
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: { "content-range": `bytes ${start}-${end}/${file.length}`, "content-length": String(end - start + 1) },
      });
    } finally {
      inFlight--;
    }
  });
  vi.stubGlobal("fetch", fetchFn);
  return { requested, peak: () => peak, fetchFn };
}

test("chunk size matches the Tauri asset protocol cap (1000 KiB)", () => {
  expect(RANGE_CHUNK).toBe(1000 * 1024);
});

test("reads with range requests, real progress, bounded concurrency", async () => {
  const file = data(RANGE_CHUNK * 5 + 123);
  const srv = rangeServer(file);
  const seen: [number, number][] = [];
  const buf = await fetchWithProgress("u", (l, t) => seen.push([l, t]));
  expect(same(new Uint8Array(buf), file)).toBe(true);
  expect(buf.byteLength).toBe(file.length);
  expect(srv.requested[0]).toBe(`bytes=0-${RANGE_CHUNK - 1}`);
  expect(srv.requested).toHaveLength(6);
  expect(srv.peak()).toBeLessThanOrEqual(4);
  expect(seen.every(([, t]) => t === file.length)).toBe(true);
  expect(seen.map(([l]) => l)).toEqual([...seen.map(([l]) => l)].sort((a, b) => a - b));
  expect(seen.at(-1)).toEqual([file.length, file.length]);
  expect(seen.length).toBeGreaterThanOrEqual(6);
});

test("short 206 responses continue from the received end", async () => {
  const file = data(RANGE_CHUNK * 2 + 10);
  const srv = rangeServer(file, { cap: 300_000 });
  const buf = await fetchWithProgress("u", () => {});
  expect(same(new Uint8Array(buf), file)).toBe(true);
  // First request: 300,000. Then two 1000 KiB slots (1,024,000 and 724,010 bytes), each in
  // pieces of at most 300,000: 4 + 3 requests.
  expect(srv.requested.length).toBe(1 + 4 + 3);
  expect(srv.requested[1]).toMatch(/^bytes=300000-/);
});

test("a server that ignores Range (200 + full body) is used as-is", async () => {
  const file = data(5000);
  const fetchFn = vi.fn(async () => new Response(file.slice(), { status: 200, headers: { "content-length": "5000" } }));
  vi.stubGlobal("fetch", fetchFn);
  const seen: [number, number][] = [];
  const buf = await fetchWithProgress("u", (l, t) => seen.push([l, t]));
  expect(same(new Uint8Array(buf), file)).toBe(true);
  expect(fetchFn).toHaveBeenCalledOnce();
  expect(seen.at(-1)).toEqual([5000, 5000]);
});

test("small files: a single range request", async () => {
  const file = data(10);
  const srv = rangeServer(file);
  expect(same(new Uint8Array(await fetchWithProgress("u", () => {})), file)).toBe(true);
  expect(srv.requested).toEqual([`bytes=0-${RANGE_CHUNK - 1}`]);
});

test("empty file: 416 with */0 gives an empty buffer", async () => {
  rangeServer(new Uint8Array(0));
  const buf = await fetchWithProgress("u", () => {});
  expect(buf.byteLength).toBe(0);
});

test("a 206 with the wrong start or length goes to the fallback", async () => {
  const file = data(RANGE_CHUNK * 3);
  rangeServer(file, {
    override: (call, _s, end) =>
      call === 2 ? new Response(new Uint8Array(4), { status: 206, headers: { "content-range": `bytes 5-8/${file.length}` } }) : (void end, null),
  });
  const fallback = vi.fn(async () => file.slice().buffer);
  const buf = await fetchWithProgress("u", () => {}, undefined, { fallback });
  expect(fallback).toHaveBeenCalledOnce();
  expect(same(new Uint8Array(buf), file)).toBe(true);
});

test("206 without a known total goes to the fallback", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(3), { status: 206, headers: { "content-range": "bytes 0-2/*" } })));
  const fallback = vi.fn(async () => new Uint8Array([1]).buffer);
  expect([...new Uint8Array(await fetchWithProgress("u", () => {}, undefined, { fallback }))]).toEqual([1]);
});

test("a failing chunk request goes to the fallback and cancels its siblings", async () => {
  const file = data(RANGE_CHUNK * 8);
  const aborted: number[] = [];
  rangeServer(file, {
    before: async (call, init) => {
      init?.signal?.addEventListener("abort", () => aborted.push(call));
      if (call === 3) throw new TypeError("Failed to fetch");
      if (call > 3) await new Promise((r) => setTimeout(r, 20));
    },
  });
  const fallback = vi.fn(async () => file.slice().buffer);
  const buf = await fetchWithProgress("u", () => {}, undefined, { fallback });
  expect(fallback).toHaveBeenCalledOnce();
  expect(buf.byteLength).toBe(file.length);
  expect(aborted.length).toBeGreaterThan(0);
});

test("abort mid-way rejects with AbortError and skips the fallback", async () => {
  const file = data(RANGE_CHUNK * 10);
  const ctl = new AbortController();
  const srv = rangeServer(file, {
    before: (call) => {
      if (call === 2) ctl.abort();
    },
  });
  const fallback = vi.fn(async () => new ArrayBuffer(0));
  const err = await fetchWithProgress("u", () => {}, ctl.signal, { fallback }).catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).name).toBe("AbortError");
  expect(fallback).not.toHaveBeenCalled();
  expect(srv.requested.length).toBeLessThan(10);
});
