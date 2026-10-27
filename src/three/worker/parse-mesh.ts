// STL/OBJ/PLY parsing into transferable typed arrays. Runs inside parse.worker.ts, but kept free
// of worker globals so node tests can call it directly.
import { BufferAttribute, type BufferGeometry, type Object3D } from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import type { ParsedTree } from "../core/scene-model";
import { meshPieces, type MeshData, type MeshFormat, type ParsedFile, type Primitive } from "./protocol";

export { meshPieces };

/** Triangles per draw chunk: ~36 MB of non-indexed positions, one chunk uploaded per frame. */
export const CHUNK_TRIANGLES = 1_000_000;

export function parseMesh(format: MeshFormat, buffer: ArrayBuffer, maxTriangles = CHUNK_TRIANGLES): ParsedFile {
  let file: ParsedFile;
  switch (format) {
    case "stl":
      // STL normals are per face: drop them and flat-shade instead (half the transfer and upload).
      file = single(new STLLoader().parse(buffer), "triangles", true);
      break;
    case "ply": {
      const geometry = new PLYLoader().parse(buffer);
      file = single(geometry, geometry.index ? "triangles" : "points", false);
      break;
    }
    case "obj":
      file = parseObjText(new TextDecoder().decode(buffer));
      break;
    default:
      throw new Error(`unsupported mesh format: ${String(format)}`);
  }
  file.meshes = chunkMeshes(file.meshes, maxTriangles);
  return file;
}

/** Replace each mesh larger than `maxTriangles` by a chunked one (see `chunkMesh`). */
export function chunkMeshes(meshes: MeshData[], maxTriangles: number): MeshData[] {
  return meshes.map((m) => {
    const pieces = chunkMesh(m, maxTriangles);
    if (pieces.length === 1) return m;
    const chunked: MeshData = { name: m.name, positions: new Float32Array(0), bounds: m.bounds, chunks: pieces };
    if (m.primitive) chunked.primitive = m.primitive;
    return chunked;
  });
}

function single(geometry: BufferGeometry, primitive: Primitive, dropNormals: boolean): ParsedFile {
  if (dropNormals) geometry.deleteAttribute("normal");
  return { tree: { meshes: [0], children: [] }, meshes: [toMeshData(geometry, "", primitive)] };
}

/**
 * Non-indexed triangles without normals stay without (the UI flat-shades them, which is what
 * computed per-face normals would give); indexed ones get smooth vertex normals.
 */
function toMeshData(geometry: BufferGeometry, name: string, primitive: Primitive): MeshData {
  if (primitive === "triangles" && geometry.index && !geometry.getAttribute("normal")) geometry.computeVertexNormals();
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

/** Axis-aligned bounds [minX, minY, minZ, maxX, maxY, maxZ] of packed xyz positions. */
export function bounds(p: Float32Array): number[] {
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
  const hasNormals = /^[ \t]*vn[ \t]/m.test(tagged);
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
    // Without `vn` lines OBJLoader fills in per-face normals: drop them and flat-shade instead.
    if (!hasNormals) obj.geometry.deleteAttribute("normal");
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

const VERTICES_PER_PRIMITIVE: Record<Primitive, number> = { triangles: 3, lines: 2, points: 1 };

/**
 * Split a mesh into draw pieces of at most `maxTriangles` triangles (points/lines: the same number
 * of vertices as that many triangles). Non-indexed pieces are views into the original buffers (no
 * copy); indexed pieces get their own compacted vertex arrays. A small mesh comes back as `[m]`.
 */
export function chunkMesh(m: MeshData, maxTriangles: number): MeshData[] {
  const per = VERTICES_PER_PRIMITIVE[m.primitive ?? "triangles"];
  const step = Math.max(per, Math.floor((maxTriangles * 3) / per) * per);
  const base = (): MeshData => {
    const p: MeshData = { name: m.name, positions: new Float32Array(0) };
    if (m.primitive) p.primitive = m.primitive;
    return p;
  };

  if (!m.indices) {
    const n = m.positions.length / 3;
    if (n <= step) return [m];
    const out: MeshData[] = [];
    for (let s = 0; s < n; s += step) {
      const e = Math.min(n, s + step);
      const piece = base();
      piece.positions = m.positions.subarray(s * 3, e * 3);
      if (m.normals) piece.normals = m.normals.subarray(s * 3, e * 3);
      if (m.colors) piece.colors = m.colors.subarray(s * 3, e * 3);
      piece.bounds = bounds(piece.positions);
      out.push(piece);
    }
    return out;
  }

  const indices = m.indices;
  if (indices.length <= step) return [m];
  const remap = new Int32Array(m.positions.length / 3).fill(-1);
  const out: MeshData[] = [];
  for (let s = 0; s < indices.length; s += step) {
    const e = Math.min(indices.length, s + step);
    const local = new Uint32Array(e - s);
    const order = new Uint32Array(e - s);
    let count = 0;
    for (let k = s; k < e; k++) {
      const v = indices[k];
      let l = remap[v];
      if (l < 0) {
        l = count++;
        remap[v] = l;
        order[l] = v;
      }
      local[k - s] = l;
    }
    const gather = (src: Float32Array): Float32Array => {
      const dst = new Float32Array(count * 3);
      for (let l = 0; l < count; l++) dst.set(src.subarray(order[l] * 3, order[l] * 3 + 3), l * 3);
      return dst;
    };
    const piece = base();
    piece.positions = gather(m.positions);
    piece.indices = local;
    if (m.normals) piece.normals = gather(m.normals);
    if (m.colors) piece.colors = gather(m.colors);
    piece.bounds = bounds(piece.positions);
    out.push(piece);
    for (let l = 0; l < count; l++) remap[order[l]] = -1;
  }
  return out;
}
