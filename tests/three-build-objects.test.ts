import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, Points, Texture, type MeshStandardMaterial, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { adoptGltfScene, buildParsedFile, disposeObject, renderableSizes } from "../src/three/core/build-objects";
import { buildTree, type TreeNode } from "../src/three/core/scene-model";
import { parseMesh } from "../src/three/worker/parse-mesh";

const FIX = join(__dirname, "fixtures", "3d");
function fixture(name: string): ArrayBuffer {
  const b = readFileSync(join(FIX, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
const ids = (n: TreeNode): string[] => [`${n.id}=${n.name}:${n.kind}`, ...n.children.flatMap(ids)];

test("buildParsedFile: one Object3D per tree node, meshes under their node", () => {
  const parsed = parseMesh("obj", fixture("groups.obj"));
  const root = buildTree(parsed.tree, "groups.obj", "f1", parsed.meshes.map((m) => m.name));
  const built = buildParsedFile(parsed, root);
  expect([...built.nodes.keys()]).toEqual(["f1", "f1/0", "f1/0/0", "f1/0/1", "f1/0/m0", "f1/1"]);
  expect(built.group).toBe(built.nodes.get("f1"));
  expect(built.nodes.get("f1/0/0")!.parent).toBe(built.nodes.get("f1/0"));
  const lid = built.nodes.get("f1/0/0")!.children[0] as Mesh;
  expect(lid).toBeInstanceOf(Mesh);
  expect(lid.geometry.getAttribute("position").count).toBe(6);
  expect(lid.geometry.boundingBox).not.toBeNull();
  expect((lid.material as MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
  expect(built.triangles).toBe(2 + 2 + 1 + 2);
});

test("buildParsedFile: vertex colors switch the material, point clouds become Points", () => {
  const ply = parseMesh("ply", fixture("cube-color.ply"));
  const built = buildParsedFile(ply, buildTree(ply.tree, "c.ply", "f2"));
  const mesh = built.group.children[0] as Mesh;
  expect((mesh.material as MeshStandardMaterial).vertexColors).toBe(true);
  expect(mesh.geometry.index?.count).toBe(36);
  expect(built.triangles).toBe(12);

  const pts = parseMesh("ply", fixture("points.ply"));
  const builtPts = buildParsedFile(pts, buildTree(pts.tree, "p.ply", "f3"));
  expect(builtPts.group.children[0]).toBeInstanceOf(Points);
  expect(builtPts.triangles).toBe(0);
});

test("adoptGltfScene: node tree mirrors the glTF hierarchy, meshes with children are split", async () => {
  const gltf = await new GLTFLoader().parseAsync(fixture("assembly.glb"), "");
  const { root, built } = adoptGltfScene(gltf.scene, "assembly.glb", "g1");
  expect(ids(root)).toEqual([
    "g1=assembly.glb:file",
    "g1/0=Assembly:assembly",
    "g1/0/0=Wheel:part",
    "g1/0/1=Body:assembly",
    "g1/0/1/0=BodyMesh:part",
    "g1/0/1/1=BodyMesh_1:part",
    "g1/0/2=Arm:assembly",
    "g1/0/2/0=Arm:part",
    "g1/0/2/1=Hand:part",
  ]);
  expect(built.group).toBe(gltf.scene);
  for (const n of ids(root)) expect(built.nodes.has(n.split("=")[0])).toBe(true);
  // Every mapped leaf is a mesh without children, so hiding it hides only itself.
  const arm = built.nodes.get("g1/0/2/0")!;
  expect((arm as Mesh).isMesh).toBe(true);
  expect(arm.children).toHaveLength(0);
  expect(built.nodes.get("g1/0/2/1")!.parent).toBe(built.nodes.get("g1/0/2"));
  // Transforms survive: Wheel keeps its translation, Hand still sits 1 above Arm.
  gltf.scene.updateMatrixWorld(true);
  expect(built.nodes.get("g1/0/0")!.position.x).toBe(2);
  const hand = built.nodes.get("g1/0/2/1")!;
  expect(hand.getWorldPosition(hand.position.clone()).y).toBe(1);
  expect(built.triangles).toBe(5);
});

test("disposeObject disposes every geometry and material once", () => {
  const ply = parseMesh("ply", fixture("cube-color.ply"));
  const built = buildParsedFile(ply, buildTree(ply.tree, "c.ply", "f4"));
  const disposed: string[] = [];
  built.group.traverse((o: Object3D) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry.addEventListener("dispose", () => disposed.push("geometry"));
    (m.material as MeshStandardMaterial).addEventListener("dispose", () => disposed.push("material"));
  });
  disposeObject(built.group);
  expect(disposed.sort()).toEqual(["geometry", "material"]);
});

test("chunked meshes: one tree node, one draw object per chunk, flat shading without normals", () => {
  const parsed = parseMesh("stl", fixture("cube-ascii.stl"), 5);
  const root = buildTree(parsed.tree, "c.stl", "f5");
  const built = buildParsedFile(parsed, root);
  expect([...built.nodes.keys()]).toEqual(["f5"]);
  expect(built.group.children).toHaveLength(3);
  expect(built.renderables).toEqual(built.group.children);
  expect(built.triangles).toBe(12);
  const mat = (built.group.children[0] as Mesh).material as MeshStandardMaterial;
  expect(mat.flatShading).toBe(true);
  // Materials stay shared across chunks.
  expect((built.group.children[2] as Mesh).material).toBe(mat);
  // Indexed PLY has normals: smooth shading.
  const ply = parseMesh("ply", fixture("cube-color.ply"));
  const plyMat = (buildParsedFile(ply, buildTree(ply.tree, "c.ply", "f6")).group.children[0] as Mesh).material as MeshStandardMaterial;
  expect(plyMat.flatShading).toBe(false);
});

test("renderableSizes: triangles, or vertices/3 for points and lines", async () => {
  const pts = parseMesh("ply", fixture("points.ply"));
  const built = buildParsedFile(pts, buildTree(pts.tree, "p.ply", "f7"));
  expect(renderableSizes(built.renderables)).toEqual([5 / 3]);
  const gltf = await new GLTFLoader().parseAsync(fixture("assembly.glb"), "");
  const { built: g } = adoptGltfScene(gltf.scene, "a.glb", "g2");
  expect(renderableSizes(g.renderables)).toEqual([1, 1, 1, 1, 1]);
});

test("disposeObject closes ImageBitmap texture images", () => {
  const close = vi.fn();
  class FakeBitmap {
    close = close;
  }
  vi.stubGlobal("ImageBitmap", FakeBitmap);
  try {
    const tex = new Texture(new FakeBitmap() as never);
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map: tex }));
    disposeObject(mesh);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
