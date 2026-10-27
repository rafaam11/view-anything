// HTML export, three side: a throwaway scene with only what is visible, ready for GLTFExporter.
// Geometries are shared with the live scene (never copied); materials are cloned in their solid
// state (display modes and section planes do not leak into the file). Every object that is a
// scene-tree node carries its id as userData.vaId (glTF node extras), so the runtime can map the
// tree back onto the loaded objects. File objects keep their full matrix: the per-file source
// frame and unit (objectMatrix) is baked into the file node.
import { BufferGeometry, Group, LineSegments, Mesh, Points, type PointsMaterial, type Material, type Object3D } from "three";
import type { TreeNode } from "../core/scene-model";
import type { ExportNode } from "./state";

export interface ExportSource {
  root: TreeNode;
  group: Object3D;
  /** Tree node id -> its Object3D. */
  nodes: Map<string, Object3D>;
}

export interface ExportScene {
  scene: Group;
  /** Free the material clones (geometries and textures belong to the live scene). */
  dispose(): void;
}

/** Shown to the user: visible, or waiting for upload and not hidden by the user meanwhile. */
function shown(o: Object3D): boolean {
  return o.visible || (o.userData.vaPending === true && o.userData.vaHidden !== true);
}

interface BaseState {
  wireframe?: boolean;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
}

function cleanMaterial(m: Material): Material {
  const c = m.clone();
  const base = m.userData.vaBase as BaseState | undefined;
  if (base) {
    const w = c as Material & { wireframe?: boolean };
    if (base.wireframe !== undefined) w.wireframe = base.wireframe;
    c.transparent = base.transparent;
    c.opacity = base.opacity;
    c.depthWrite = base.depthWrite;
    c.polygonOffset = base.polygonOffset;
    c.polygonOffsetFactor = base.polygonOffsetFactor;
    c.polygonOffsetUnits = base.polygonOffsetUnits;
  }
  c.clippingPlanes = null;
  c.userData = {};
  return c;
}

export function buildExportScene(sources: readonly ExportSource[]): ExportScene {
  const scene = new Group();
  const clones = new Map<Material, Material>();
  const pointGeometries: BufferGeometry[] = [];
  const material = (m: Material): Material => {
    let c = clones.get(m);
    if (!c) {
      c = cleanMaterial(m);
      clones.set(m, c);
    }
    return c;
  };
  const materials = (m: Material | Material[]) => (Array.isArray(m) ? m.map(material) : material(m));

  for (const { group, nodes } of sources) {
    const ids = new Map<Object3D, string>([...nodes].map(([id, o]) => [o, id]));
    const copy = (o: Object3D): Object3D | null => {
      if (o.userData.vaEdges || !shown(o)) return null;
      const r = o as Partial<Mesh & Points & LineSegments>;
      let out: Object3D;
      if (r.isMesh) out = new Mesh(r.geometry, materials(r.material as Material | Material[]));
      else if (r.isPoints) {
        const g = new BufferGeometry();
        for (const [name, attr] of Object.entries(r.geometry!.attributes)) if (!name.startsWith("va")) g.setAttribute(name, attr);
        g.setIndex(r.geometry!.index); g.boundingBox = r.geometry!.boundingBox; g.boundingSphere = r.geometry!.boundingSphere;
        pointGeometries.push(g);
        out = new Points(g, materials(r.material as Material | Material[]));
        out.userData.vaPointSize = (r.material as PointsMaterial).size;
      }
      else if ((r as LineSegments).isLineSegments) out = new LineSegments(r.geometry, materials(r.material as Material | Material[]));
      else out = new Group();
      out.name = o.name;
      if (o.matrixAutoUpdate) o.updateMatrix();
      out.matrixAutoUpdate = false;
      out.matrix.copy(o.matrix);
      const id = ids.get(o);
      if (id) out.userData.vaId = id;
      for (const child of o.children) {
        const c = copy(child);
        if (c) out.add(c);
      }
      return out;
    };
    const file = copy(group);
    if (file) scene.add(file);
  }
  return {
    scene,
    dispose: () => { clones.forEach((m) => m.dispose()); pointGeometries.forEach((g) => g.dispose()); },
  };
}

/** The visible part of a scene tree, for the state JSON (names, ids, kinds). */
export function exportTree(node: TreeNode): ExportNode {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    visible: node.visible,
    children: node.children.filter((c) => c.visible).map(exportTree),
  };
}

/** Binary glTF of `scene` (three's GLTFExporter, loaded on demand). */
export async function exportGlb(scene: Object3D): Promise<Uint8Array> {
  if (typeof Worker !== "undefined") {
    const worker = new Worker(new URL("./scene.worker.ts", import.meta.url), { type: "module" });
    let failure: Error | null = null;
    let rejectPending: ((error: Error) => void) | null = null;
    worker.onerror = (event) => {
      failure = new Error(event.message || "export worker failed");
      rejectPending?.(failure);
    };
    try {
      const { packScene } = await import("./transfer-scene");
      const { packet, transfer } = await packScene(scene);
      if (failure) { Object.values(packet.images).forEach((image) => image.close()); throw failure; }
      return await new Promise<Uint8Array>((resolve, reject) => {
        rejectPending = reject;
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(new Uint8Array(data.result));
        try { worker.postMessage(packet, transfer); }
        catch (error) { Object.values(packet.images).forEach((image) => image.close()); reject(error); }
      });
    } finally { worker.terminate(); }
  }
  let vertices = 0;
  scene.traverse((o) => { const g = (o as Mesh).geometry; if (g) vertices += g.getAttribute("position")?.count ?? 0; });
  if (vertices > 150_000) throw new Error("백그라운드 작업자를 쓸 수 없어 큰 장면을 HTML로 내보낼 수 없습니다.");
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  scene.updateMatrixWorld(true);
  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error("GLTFExporter did not return a GLB");
  return new Uint8Array(result);
}

/**
 * Files that go into an export: those whose file node is shown. Everything about the export
 * (title, default file name, state) is computed from these, so a hidden file never leaks out.
 */
export function visibleFiles<T extends { file: { root: { visible: boolean } } }>(files: readonly T[]): T[] {
  return files.filter((f) => f.file.root.visible);
}
