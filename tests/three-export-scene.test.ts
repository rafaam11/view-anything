// @vitest-environment happy-dom
// HTML export, three side: only visible content is exported, per-file frame matrices are baked
// into the file nodes, node ids survive as extras.vaId, display-mode material changes do not leak
// into the file; the meshopt-compressed GLB loads back through GLTFLoader + MeshoptDecoder.
import { expect, test } from "vitest";
import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { buildExportScene, exportTree, exportGlb, visibleFiles } from "../src/three/export/scene";
import { defaultHtmlPath, exportTitle } from "../src/three/export/template";
import { compressGlb } from "../src/three/export/compress";
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder as MeshoptDecoderRaw } from "meshoptimizer";
import { CHECKER, texturedGlb } from "./textured-glb";
import { DisplayModes } from "../src/three/core/display-modes";
import { objectMatrix } from "../src/three/core/frames";
import type { TreeNode } from "../src/three/core/scene-model";

function fixture() {
  const material = new MeshStandardMaterial({ color: 0x808080 });
  const a = new Mesh(new BoxGeometry(2, 2, 2), material);
  a.name = "A";
  const b = new Mesh(new BoxGeometry(1, 1, 1), material);
  b.name = "B";
  b.position.set(5, 0, 0);
  const partA = new Group().add(a);
  partA.name = "</script> A";
  const partB = new Group().add(b);
  partB.name = "B part";
  const group = new Group().add(partA, partB);
  // Baked per-file frame (inch, Y-up source on a Z-up mm display), as the stage sets it.
  group.matrixAutoUpdate = false;
  group.matrix.fromArray(objectMatrix("zup-rh", "mm", "yup-rh", "in"));
  const root: TreeNode = {
    id: "f1",
    name: "a.glb",
    kind: "file",
    visible: true,
    meshIds: [],
    children: [
      { id: "f1/0", name: partA.name, kind: "part", visible: true, children: [], meshIds: [0] },
      { id: "f1/1", name: partB.name, kind: "part", visible: false, children: [], meshIds: [1] },
    ],
  };
  const nodes = new Map<string, Object3D>([
    ["f1", group],
    ["f1/0", partA],
    ["f1/1", partB],
  ]);
  partB.visible = false; // hidden in the panel
  return { group, nodes, root, material, a };
}

test("export scene: hidden nodes left out, ids as userData.vaId, frame matrix baked, materials clean", () => {
  const { group, nodes, root, material, a } = fixture();
  // X-ray on: the live material is transparent; the export must not be.
  const modes = new DisplayModes(null);
  modes.apply(group, "xray");
  expect(material.transparent).toBe(true);

  const out = buildExportScene([{ root, group, nodes }]);
  const file = out.scene.children[0];
  expect(file.userData.vaId).toBe("f1");
  expect(file.matrix.equals(group.matrix)).toBe(true);
  const ids: string[] = [];
  out.scene.traverse((o) => o.userData.vaId && ids.push(o.userData.vaId));
  expect(ids).toEqual(["f1", "f1/0"]);
  const exported = file.children[0].children[0] as Mesh;
  expect(exported.geometry).toBe(a.geometry); // shared, not copied
  const m = exported.material as MeshStandardMaterial;
  expect(m).not.toBe(material);
  expect(m.transparent).toBe(false);
  expect(m.opacity).toBe(1);
  expect(m.depthWrite).toBe(true);
  expect(m.userData).toEqual({});
  expect(m.clippingPlanes).toBeNull();
  out.dispose();
  expect(material.transparent).toBe(true); // the live scene is untouched

  const tree = exportTree(root);
  expect(tree).toEqual({ id: "f1", name: "a.glb", kind: "file", visible: true, children: [{ id: "f1/0", name: "</script> A", kind: "part", visible: true, children: [] }] });
});

test("edge lines and nothing-visible files are not exported", () => {
  const { group, nodes, root } = fixture();
  const modes = new DisplayModes(null);
  modes.apply(group, "edges");
  let lines = 0;
  group.traverse((o) => o.userData.vaEdges && lines++);
  expect(lines).toBeGreaterThan(0);
  const out = buildExportScene([{ root, group, nodes }]);
  out.scene.traverse((o) => expect(o.userData.vaEdges).toBeUndefined());
  out.dispose();

  group.visible = false;
  root.visible = false;
  expect(buildExportScene([{ root, group, nodes }]).scene.children).toHaveLength(0);
});

test("GLB -> meshopt -> GLTFLoader keeps ids, names, matrices and geometry", async () => {
  const { group, nodes, root } = fixture();
  const out = buildExportScene([{ root, group, nodes }]);
  const glb = await exportGlb(out.scene);
  out.dispose();
  const packed = await compressGlb(glb);
  const text = new TextDecoder().decode(packed.slice(0, Math.min(packed.length, 4000)));
  expect(text).toContain("EXT_meshopt_compression");

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer, "");
  const byId = new Map<string, Object3D>();
  gltf.scene.traverse((o) => o.userData.vaId && byId.set(o.userData.vaId, o));
  expect([...byId.keys()].sort()).toEqual(["f1", "f1/0"]);
  const file = byId.get("f1")!;
  file.updateMatrix();
  const expected = new Matrix4().fromArray(objectMatrix("zup-rh", "mm", "yup-rh", "in"));
  file.matrix.elements.forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i], 4));
  // GLTFLoader sanitizes object names, so the runtime takes names from the state JSON tree.
  expect(byId.get("f1/0")!.name).not.toBe("");
  let triangles = 0;
  gltf.scene.traverse((o) => {
    const g = (o as Mesh).geometry;
    if ((o as Mesh).isMesh) triangles += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  });
  expect(triangles).toBe(12);
  // Positions survive quantization within a small tolerance (box corners at ±1).
  gltf.scene.updateMatrixWorld(true);
  const mesh = byId.get("f1/0")!.children[0] as Mesh;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix);
  expect(box.max.x).toBeCloseTo(1, 2);
  expect(box.min.y).toBeCloseTo(-1, 2);
});

test("hidden files never reach the export (first file hidden: title and name come from the rest)", () => {
  const files = [
    { file: { name: "secret.step", path: "D:/m/secret.step", root: { visible: false } } },
    { file: { name: "b.stl", path: "D:/m/b.stl", root: { visible: true } } },
    { file: { name: "c.obj", path: "D:/m/c.obj", root: { visible: true } } },
  ];
  const shown = visibleFiles(files);
  expect(shown.map((f) => f.file.name)).toEqual(["b.stl", "c.obj"]);
  expect(exportTitle(shown.map((f) => f.file.name))).toBe("b.stl 외 1개");
  expect(defaultHtmlPath(shown[0].file.path)).toBe("D:/m/b.html");
});

test("textures survive compression: the PNG, its material slot, UVs and the node ids", async () => {
  const packed = await compressGlb(await texturedGlb());
  const doc = await new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoderRaw }).readBinary(packed);
  const [texture] = doc.getRoot().listTextures();
  expect(texture.getMimeType()).toBe("image/png");
  expect(texture.getImage()).toEqual(CHECKER);
  const [material] = doc.getRoot().listMaterials();
  expect(material.getBaseColorTexture()).toBe(texture);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  expect(prim.getAttribute("TEXCOORD_0")).not.toBeNull();
  expect(doc.getRoot().listNodes().map((n) => n.getExtras().vaId).sort()).toEqual(["f1", "f1/0"]);
});
