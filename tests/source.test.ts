import { afterEach, expect, test, vi } from "vitest";
import { fetchWithProgress } from "../src/three/io/source";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

function respond(chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(chunks), { status, headers })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const bytes = (...n: number[]) => new Uint8Array(n);

test("streams into a Content-Length sized buffer and reports progress", async () => {
  respond([bytes(1, 2), bytes(3), bytes(4, 5, 6)], { "content-length": "6" });
  const seen: [number, number][] = [];
  const buf = await fetchWithProgress("http://asset.localhost/x", (l, t) => seen.push([l, t]));
  expect([...new Uint8Array(buf)]).toEqual([1, 2, 3, 4, 5, 6]);
  expect(buf.byteLength).toBe(6);
  expect(seen.at(-1)).toEqual([6, 6]);
  expect(seen.map((s) => s[0])).toEqual([...seen.map((s) => s[0])].sort((a, b) => a - b));
  expect(seen.every(([, t]) => t === 6)).toBe(true);
});

test("works without Content-Length", async () => {
  respond([bytes(9), bytes(8, 7)]);
  const seen: [number, number][] = [];
  const buf = await fetchWithProgress("u", (l, t) => seen.push([l, t]));
  expect([...new Uint8Array(buf)]).toEqual([9, 8, 7]);
  expect(seen.at(-1)).toEqual([3, 3]);
});

test("tolerates a body longer or shorter than Content-Length", async () => {
  respond([bytes(1, 2, 3, 4)], { "content-length": "2" });
  expect([...new Uint8Array(await fetchWithProgress("u", () => {}))]).toEqual([1, 2, 3, 4]);
  respond([bytes(1)], { "content-length": "5" });
  expect([...new Uint8Array(await fetchWithProgress("u", () => {}))]).toEqual([1]);
});

test("falls back when fetch fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  const fallback = vi.fn(async () => bytes(7, 7).buffer);
  const seen: [number, number][] = [];
  const buf = await fetchWithProgress("u", (l, t) => seen.push([l, t]), undefined, { fallback });
  expect(fallback).toHaveBeenCalledOnce();
  expect([...new Uint8Array(buf)]).toEqual([7, 7]);
  expect(seen.at(-1)).toEqual([2, 2]);
});

test("falls back on an HTTP error status", async () => {
  respond([bytes(0)], {}, 404);
  const fallback = vi.fn(async () => bytes(5).buffer);
  const buf = await fetchWithProgress("u", () => {}, undefined, { fallback });
  expect([...new Uint8Array(buf)]).toEqual([5]);
});

test("rethrows without a fallback", async () => {
  respond([bytes(0)], {}, 500);
  await expect(fetchWithProgress("u", () => {})).rejects.toThrow(/500/);
});

test("abort is not swallowed by the fallback", async () => {
  const ctl = new AbortController();
  ctl.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response("x");
    }),
  );
  const fallback = vi.fn(async () => bytes(1).buffer);
  await expect(fetchWithProgress("u", () => {}, ctl.signal, { fallback })).rejects.toThrow(/abort/i);
  expect(fallback).not.toHaveBeenCalled();
});
