// STL/OBJ/PLY parsing into transferable typed arrays. Runs inside parse.worker.ts, but kept free
// of worker globals so node tests can call it directly.
import { BufferAttribute, type BufferGeometry, type Object3D } from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import type { ParsedTree } from "../core/scene-model";
import type { MeshData, MeshFormat, ParsedFile, Primitive } from "./protocol";

export function parseMesh(format: MeshFormat, buffer: ArrayBuffer): ParsedFile {
  switch (format) {
    case "stl":
      return single(new STLLoader().parse(buffer), "triangles");
    case "ply": {
      const geometry = new PLYLoader().parse(buffer);
      return single(geometry, geometry.index ? "triangles" : "points");
    }
    case "obj":
      return parseObjText(new TextDecoder().decode(buffer));
    default:
      throw new Error(`unsupported mesh format: ${String(format)}`);
  }
}

function single(geometry: BufferGeometry, primitive: Primitive): ParsedFile {
  return { tree: { meshes: [0], children: [] }, meshes: [toMeshData(geometry, "", primitive)] };
}

function toMeshData(geometry: BufferGeometry, name: string, primitive: Primitive): MeshData {
  if (primitive === "triangles" && !geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const positions = floats(geometry.getAttribute("position"), 3)!;
  const mesh: MeshData = { name, positions, bounds: bounds(positions) };
  if (primitive !== "triangles") mesh.primitive = primitive;
  const normals = primitive === "triangles" ? floats(geometry.getAttribute("normal"), 3) : undefined;
  if (normals) mesh.normals = normals;
  const colors = floats(geometry.getAttribute("color"), 3);
  if (colors) mesh.colors = colors;
  const index = geometry.index;
  if (index) mesh.indices = index.array instanceof Uint32Array ? index.array : Uint32Array.from(index.array);
  return mesh;
}

type AnyAttribute = ReturnType<BufferGeometry["getAttribute"]> | undefined;

/** Attribute as a tightly packed Float32Array with `size` components (extra ones, e.g. alpha, dropped). */
function floats(attr: AnyAttribute, size: number): Float32Array | undefined {
  if (!attr) return undefined;
  if (attr instanceof BufferAttribute && attr.itemSize === size && attr.array instanceof Float32Array && !attr.normalized) {
    // Own the whole buffer so it can be transferred without dragging neighbours along.
    const a = attr.array;
    return a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a.slice();
  }
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i++) {
    out[i * size] = attr.getX(i);
    if (size > 1) out[i * size + 1] = attr.getY(i);
    if (size > 2) out[i * size + 2] = attr.getZ(i);
  }
  return out;
}

function bounds(p: Float32Array): number[] {
  if (p.length < 3) return [0, 0, 0, 0, 0, 0];
  let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0, y0, z0, x1, y1, z1];
}

interface Declaration {
  kind: "o" | "g";
  name: string;
  /** Index of the enclosing `o` declaration, -1 at top level (only for `g`). */
  parent: number;
}

const TAG = "\u0001va";
const DECLARATION = /^[ \t]*([og])(?:[ \t]+([^\n]*?))?[ \t]*$/gm;

/**
 * OBJ text -> ParsedFile. OBJLoader flattens `o` and `g` into sibling objects, so each statement
 * is first tagged with its declaration index; the tags then rebuild the hierarchy: `g` nests under
 * the latest `o`, repeated names under the same parent merge, faces outside any o/g stay on the
 * root, and declarations without geometry are dropped.
 */
export function parseObjText(text: string): ParsedFile {
  const decls: Declaration[] = [];
  let currentObject = -1;
  const tagged = (text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text).replace(DECLARATION, (_m, kind: "o" | "g", name?: string) => {
    const index = decls.length;
    decls.push({ kind, name: name ?? "", parent: kind === "g" ? currentObject : -1 });
    if (kind === "o") currentObject = index;
    return `${kind} ${TAG}${index}`;
  });

  // A leading declaration claims faces that come before any o/g; otherwise OBJLoader renames that
  // default object after the first declaration and the loose faces would join it.
  const container = new OBJLoader().parse(`o ${TAG}root\n${tagged}`);
  const root: ParsedTree = { meshes: [], children: [] };
  const byKey = new Map<string, ParsedTree>();
  const keyOf = new Map<ParsedTree, string>([[root, ""]]);

  const nodeFor = (d: number): ParsedTree => {
    const decl = decls[d];
    const parent = decl.kind === "g" && decl.parent >= 0 ? nodeFor(decl.parent) : root;
    const key = `${keyOf.get(parent)}\u0000${decl.kind}:${decl.name}`;
    let node = byKey.get(key);
    if (!node) {
      node = { name: decl.name, meshes: [], children: [] };
      byKey.set(key, node);
      keyOf.set(node, key);
      parent.children.push(node);
    }
    return node;
  };
  // Create nodes in declaration order so the tree follows the file, then prune empty ones.
  decls.forEach((_d, i) => nodeFor(i));

  const meshes: MeshData[] = [];
  container.children.forEach((child: Object3D) => {
    const match = child.name.startsWith(TAG) ? Number(child.name.slice(TAG.length)) : NaN;
    const decl = Number.isInteger(match) ? decls[match] : undefined;
    const obj = child as Object3D & { geometry: BufferGeometry; isLineSegments?: boolean; isPoints?: boolean };
    const primitive: Primitive = obj.isLineSegments ? "lines" : obj.isPoints ? "points" : "triangles";
    meshes.push(toMeshData(obj.geometry, decl?.name ?? "", primitive));
    (decl ? nodeFor(match) : root).meshes.push(meshes.length - 1);
  });

  prune(root);
  return { tree: root, meshes };
}

/** Drop nodes with no meshes anywhere below them. Returns whether `node` keeps content. */
function prune(node: ParsedTree): boolean {
  node.children = node.children.filter(prune);
  return node.meshes.length > 0 || node.children.length > 0;
}
