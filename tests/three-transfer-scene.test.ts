import { expect, test } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Color } from "three";
import { packScene, unpackScene } from "../src/three/export/transfer-scene";

test("worker scene transfer preserves shared geometry, material, groups, transform and names", async () => {
  const g = new BoxGeometry(2, 3, 4);
  const material = new MeshStandardMaterial({ color: 0x123456, roughness: 0.4, metalness: 0.2 });
  const root = new Group();
  const a = new Mesh(g, material), b = new Mesh(g, material);
  a.name = '</script>한글'; a.userData.vaId = "f1/0";
  a.position.set(1, 2, 3); a.updateMatrix();
  b.position.set(4, 5, 6); b.updateMatrix();
  root.add(a, b);
  const { packet, transfer } = await packScene(root);
  expect(Object.keys(packet.geometries)).toHaveLength(1);
  const received = structuredClone(packet, { transfer });
  const restored = unpackScene(received);
  const [ra, rb] = restored.children as Mesh[];
  expect(ra.geometry).toBe(rb.geometry);
  expect(ra.material).toBe(rb.material);
  expect(ra.name).toBe(a.name);
  expect(ra.userData.vaId).toBe("f1/0");
  expect(ra.position.toArray()).toEqual([1, 2, 3]);
  expect((ra.material as MeshStandardMaterial).color).toEqual(new Color(0x123456));
  expect(ra.geometry.groups).toEqual(g.groups);
  expect(Array.from(ra.geometry.getAttribute("position").array)).toEqual(Array.from(g.getAttribute("position").array));
  expect(g.getAttribute("position").array.byteLength).toBeGreaterThan(0);
});
