// Turns parser output into three.js objects and maps scene-tree node ids to Object3Ds, so the
// panel (visibility) and later tasks can address any node.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Sphere,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { buildTree, type ParsedTree, type TreeNode } from "./scene-model";
import { meshPieces, type MeshData, type ParsedFile } from "../worker/protocol";

export interface BuiltFile {
  /** The file's root object; its matrix carries the per-file source-frame transform. */
  group: Object3D;
  /** Tree node id -> the Object3D whose `visible` flag mirrors that node. */
  nodes: Map<string, Object3D>;
  /** Triangle count over all triangle meshes. */
  triangles: number;
  /** Every draw object, in scene order (the stage uploads them in batches). */
  renderables: Object3D[];
}

const DEFAULT_COLOR = 0xb4bcc6;

type Renderable = Mesh | Points | LineSegments;

function isRenderable(o: Object3D): o is Renderable {
  const r = o as Partial<Mesh & Points & LineSegments>;
  return r.isMesh === true || r.isPoints === true || r.isLine === true;
}

/** Upload weight per object: triangles, or vertices/3 for points and lines. */
export function renderableSizes(objects: readonly Object3D[]): number[] {
  return objects.map((o) => {
    const m = o as Mesh;
    if (m.isMesh) return triangleCount(o);
    return (m.geometry?.getAttribute("position")?.count ?? 0) / 3;
  });
}

function triangleCount(o: Object3D): number {
  const m = o as Mesh;
  if (!m.isMesh) return 0;
  const g = m.geometry;
  return Math.floor((g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3);
}

/** Materials are shared per file and created on first use. */
class MaterialSet {
  private cache = new Map<string, Material>();
  get(primitive: string, vertexColors: boolean, flatShading: boolean): Material {
    const key = `${primitive}:${vertexColors}:${flatShading}`;
    let m = this.cache.get(key);
    if (!m) {
      const color = vertexColors ? 0xffffff : DEFAULT_COLOR;
      if (primitive === "points") m = new PointsMaterial({ color, vertexColors, size: 2, sizeAttenuation: false });
      else if (primitive === "lines") m = new LineBasicMaterial({ color, vertexColors });
      // DoubleSide: STL/OBJ exports often have inconsistent winding.
      // flatShading: meshes sent without normals (STL, OBJ without vn) are lit per face.
      else m = new MeshStandardMaterial({ color, vertexColors, flatShading, metalness: 0.05, roughness: 0.6, side: DoubleSide });
      this.cache.set(key, m);
    }
    return m;
  }
}

function geometryOf(data: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(data.positions, 3));
  if (data.normals) g.setAttribute("normal", new BufferAttribute(data.normals, 3));
  if (data.colors) g.setAttribute("color", new BufferAttribute(data.colors, 3));
  if (data.indices) g.setIndex(new BufferAttribute(data.indices, 1));
  if (data.bounds) {
    // Bounds come from the worker, so the UI thread does not rescan large position arrays.
    const [x0, y0, z0, x1, y1, z1] = data.bounds;
    g.boundingBox = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  } else {
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return g;
}

function objectOf(data: MeshData, materials: MaterialSet): Renderable {
  const geometry = geometryOf(data);
  const primitive = data.primitive ?? "triangles";
  const material = materials.get(primitive, data.colors !== undefined, primitive === "triangles" && !data.normals);
  const o = primitive === "points" ? new Points(geometry, material) : primitive === "lines" ? new LineSegments(geometry, material) : new Mesh(geometry, material);
  o.name = data.name;
  return o;
}

/** Worker output -> one Group per tree node, meshes attached to the node that owns them. */
export function buildParsedFile(parsed: ParsedFile, root: TreeNode): BuiltFile {
  const materials = new MaterialSet();
  const nodes = new Map<string, Object3D>();
  const renderables: Object3D[] = [];
  let triangles = 0;
  const build = (node: TreeNode): Object3D => {
    const group = new Group();
    group.name = node.name;
    nodes.set(node.id, group);
    for (const i of node.meshIds) {
      // A chunked mesh stays one tree node: its pieces are siblings under the node's group.
      for (const piece of meshPieces(parsed.meshes[i])) {
        const o = objectOf({ ...piece, name: parsed.meshes[i].name }, materials);
        triangles += triangleCount(o);
        renderables.push(o);
        group.add(o);
      }
    }
    for (const child of node.children) group.add(build(child));
    return group;
  };
  const group = build(root);
  return { group, nodes, triangles, renderables };
}

/**
 * A renderable object that also has renderable children cannot be hidden on its own. Move such
 * an object's transform onto a new Group that takes its place, and put the object (now with an
 * identity transform) and its former children under that Group.
 */
function splitMeshesWithChildren(scene: Object3D): void {
  const targets: Object3D[] = [];
  scene.traverse((o) => {
    if (o !== scene && isRenderable(o) && o.children.some(hasRenderable)) targets.push(o);
  });
  for (const o of targets) {
    const group = new Group();
    group.name = o.name;
    group.position.copy(o.position);
    group.quaternion.copy(o.quaternion);
    group.scale.copy(o.scale);
    group.matrixAutoUpdate = o.matrixAutoUpdate;
    group.matrix.copy(o.matrix);
    group.visible = o.visible;
    const parent = o.parent!;
    parent.children[parent.children.indexOf(o)] = group;
    group.parent = parent;
    o.parent = null;
    const children = [...o.children];
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
    o.matrix.identity();
    group.add(o);
    for (const c of children) group.add(c);
  }
}

function hasRenderable(o: Object3D): boolean {
  if (isRenderable(o)) return true;
  return o.children.some(hasRenderable);
}

/**
 * Adopt a loaded glTF scene as-is (transforms, materials, textures stay) and build its scene
 * tree: every Object3D on the way to a renderable becomes a node; renderables are leaves.
 */
export function adoptGltfScene(scene: Object3D, fileName: string, fileId: string): { root: TreeNode; built: BuiltFile } {
  splitMeshesWithChildren(scene);
  const meshObjects: Object3D[] = [];
  const toParsed = (o: Object3D): ParsedTree => {
    if (isRenderable(o)) {
      meshObjects.push(o);
      return { name: o.name, meshes: [meshObjects.length - 1], children: [] };
    }
    return { name: o.name, meshes: [], children: o.children.filter(hasRenderable).map(toParsed) };
  };
  // The scene object itself is the file node (unnamed root merges into it).
  const parsed: ParsedTree = { meshes: [], children: scene.children.filter(hasRenderable).map(toParsed) };
  const root = buildTree(parsed, fileName, fileId, meshObjects.map((o) => o.name));

  const nodes = new Map<string, Object3D>();
  const link = (node: TreeNode, o: Object3D) => {
    nodes.set(node.id, o);
    const kids = isRenderable(o) ? [] : o.children.filter(hasRenderable);
    node.children.forEach((child, i) => link(child, kids[i]));
  };
  link(root, scene);
  const triangles = meshObjects.reduce((n, o) => n + triangleCount(o), 0);
  return { root, built: { group: scene, nodes, triangles, renderables: meshObjects } };
}

/** Dispose every geometry, material and texture under `root` (each once). */
export function disposeObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((o) => {
    if (!isRenderable(o)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  const textures = new Set<Texture>();
  for (const m of materials) {
    for (const value of Object.values(m)) {
      if (value && (value as Texture).isTexture) textures.add(value as Texture);
    }
  }
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    // three does not release decoded ImageBitmaps (GLTFLoader on Chromium) on dispose.
    const image = t.image as { close?: () => void } | null;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close?.();
  });
}
