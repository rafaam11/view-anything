import { expect, test } from "vitest";
import { decodeChunk, editedPath } from "../src/three/cloud/types";
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
