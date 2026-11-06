// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { createUploadPacer, decodeChunk, editedPath, nextFrame } from "../src/three/cloud/types";
import { BufferAttribute, BufferGeometry, Group, Points, PointsMaterial } from "three";
import { buildExportScene } from "../src/three/export/scene";

test("cloud packets retain source IDs and decode bounded little-endian geometry", () => {
  const b = new ArrayBuffer(40), v = new DataView(b);
  for (let i = 0; i < 2; i++) { v.setFloat32(i * 20, 123.25 + i, true); v.setUint8(i * 20 + 12, 255); v.setUint8(i * 20 + 15, i); v.setUint32(i * 20 + 16, i ? 9_999_999 : 0, true); }
  const data = decodeChunk(b);
  expect([...data.positions]).toEqual([123.25, 0, 0, 124.25, 0, 0]);
  expect([...data.colors]).toEqual([1, 0, 0, 1, 0, 0]);
  expect([...data.selected]).toEqual([0, 1]);
  expect(data.pick[3] + data.pick[4] * 256 + data.pick[5] * 65536).toBe(10_000_000);
  expect(() => decodeChunk(new ArrayBuffer(19))).toThrow();
  expect(() => decodeChunk(new ArrayBuffer(500_020))).toThrow();
});
test("edited name preserves original format and path", () => {
  expect(editedPath("D:\\센서\\a.PCD")).toBe("D:\\센서\\a_edited.PCD");
  expect(editedPath("/tmp/cloud.ply")).toBe("/tmp/cloud_edited.ply");
});
test("HTML points preserve point size but never leak picking/selection data", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([1, 2, 3]), 3));
  geometry.setAttribute("vaPick", new BufferAttribute(new Uint8Array([1, 0, 0]), 3, true));
  geometry.setAttribute("vaSelected", new BufferAttribute(new Uint8Array([1]), 1));
  const points = new Points(geometry, new PointsMaterial({ size: 7, sizeAttenuation: false }));
  const group = new Group(); group.add(points);
  const root = { id: "f1", name: "cloud", kind: "file" as const, visible: true, children: [], meshIds: [0] };
  const out = buildExportScene([{ root, group, nodes: new Map([[root.id, group]]) }]);
  const p = out.scene.children[0].children[0] as Points;
  expect(p.userData.vaPointSize).toBe(7);
  expect(Object.keys(p.geometry.attributes)).toEqual(["position"]);
  expect(p.geometry.getAttribute("position")).toBe(geometry.getAttribute("position"));
  out.dispose(); expect(geometry.getAttribute("vaPick")).toBeDefined();
});

test("the upload pacer yields only after its time budget", () => {
  let t = 0;
  const pacer = createUploadPacer(() => t, 12);
  t = 5; expect(pacer.shouldYield()).toBe(false);
  t = 12; expect(pacer.shouldYield()).toBe(true);
  pacer.reset(); t = 20; expect(pacer.shouldYield()).toBe(false);
});

test("a hidden document does not wait for frames or throttled timers", async () => {
  const raf = vi.fn(); vi.stubGlobal("requestAnimationFrame", raf);
  vi.useFakeTimers();
  try { await nextFrame(() => true); expect(raf).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); }
  finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

test("a frame wait ends when the window is hidden meanwhile", async () => {
  const raf = vi.fn(() => 1); vi.stubGlobal("requestAnimationFrame", raf);
  try {
    let done = false;
    const wait = nextFrame(() => false).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await wait;
    expect(done).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});

test("a visible document yields to the next animation frame", async () => {
  const raf = vi.fn((cb: FrameRequestCallback) => { cb(0); return 1; }); vi.stubGlobal("requestAnimationFrame", raf);
  try { await nextFrame(() => false); expect(raf).toHaveBeenCalledTimes(1); }
  finally { vi.unstubAllGlobals(); }
});
