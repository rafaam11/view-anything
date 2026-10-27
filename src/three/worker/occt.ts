// STEP/IGES through occt-import-js (OpenCascade compiled to wasm). Loaded only by the parse worker
// (dynamic import) for those formats, so STL/OBJ/PLY loads never fetch the 7 MB wasm. Free of
// worker globals so node tests can run the real occt on fixtures.
import type { ParsedTree } from "../core/scene-model";
import type { OcctParams } from "./cad-params";
import { bounds, chunkMeshes, CHUNK_TRIANGLES } from "./parse-mesh";
import { DEFAULT_COLOR, type CadFormat, type MeshData, type ParsedFile } from "./protocol";

/** occt-import-js result node: the same shape as ParsedTree. */
export interface OcctNode {
  name: string;
  meshes: number[];
  children: OcctNode[];
}

export interface OcctMesh {
  name?: string;
  /** Linear RGB 0..1 (OCCT colours are linear), for faces without their own colour. */
  color?: number[];
  /** Triangle ranges [first, last] (inclusive) of each source b-rep face. */
  brep_faces?: { first: number; last: number; color: number[] | null }[];
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
  index?: { array: ArrayLike<number> };
}

export interface OcctResult {
  success: boolean;
  root: OcctNode;
  meshes: OcctMesh[];
}

export interface OcctModule {
  ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult;
}

/**
 * Instantiate occt. In the worker `wasmUrl` is Vite's emitted asset URL; without it (node tests)
 * emscripten reads the wasm next to its own script.
 */
export async function loadOcct(wasmUrl?: string): Promise<OcctModule> {
  const { default: factory } = await import("occt-import-js");
  return (await factory(wasmUrl ? { locateFile: () => wasmUrl } : {})) as OcctModule;
}

const LABEL: Record<CadFormat, string> = { step: "STEP", iges: "IGES" };

/** The file bytes, handed over so readCad can drop them once occt has its own copy. */
export interface CadSource {
  bytes: Uint8Array | null;
}

/**
 * Tessellate a STEP/IGES file (whole file in `content`) into transferable meshes. Given a
 * CadSource, its `bytes` are cleared as soon as occt has read them, so (with no other reference
 * left) the file buffer can be collected while the result is converted.
 */
export function readCad(occt: OcctModule, format: CadFormat, content: Uint8Array | CadSource, params: OcctParams, maxTriangles = CHUNK_TRIANGLES): ParsedFile {
  const result = readWith(occt, format, content, params);
  if (!(content instanceof Uint8Array)) content.bytes = null;
  if (!result?.success) throw new Error(`${LABEL[format]} 파일을 해석하지 못했습니다`);
  return mapOcctResult(result, maxTriangles);
}

function readWith(occt: OcctModule, format: CadFormat, content: Uint8Array | CadSource, params: OcctParams): OcctResult {
  const bytes = content instanceof Uint8Array ? content : content.bytes;
  if (!bytes) throw new Error("readCad: source bytes were already released");
  return format === "step" ? occt.ReadStepFile(bytes, params) : occt.ReadIgesFile(bytes, params);
}

/**
 * occt result -> ParsedFile: the node tree as is, typed arrays, b-rep face colours as vertex
 * colours, bounds, and draw chunks for big meshes. Releases each occt mesh once converted.
 */
export function mapOcctResult(result: OcctResult, maxTriangles = CHUNK_TRIANGLES): ParsedFile {
  if (!result.success) throw new Error("occt could not read the file");
  const meshes: MeshData[] = [];
  for (let i = 0; i < result.meshes.length; i++) {
    meshes.push(toMeshData(result.meshes[i]));
    (result.meshes as (OcctMesh | null)[])[i] = null; // occt's plain number arrays are big
  }
  return { tree: copyTree(result.root), meshes: chunkMeshes(meshes, maxTriangles) };
}

function copyTree(node: OcctNode): ParsedTree {
  return { name: node.name, meshes: [...node.meshes], children: node.children.map(copyTree) };
}

function toMeshData(m: OcctMesh): MeshData {
  let positions: Float32Array = Float32Array.from(m.attributes.position.array);
  let normals: Float32Array | undefined = m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : undefined;
  let indices: Uint32Array | undefined = m.index ? Uint32Array.from(m.index.array) : undefined;
  let colors: Float32Array | undefined;

  const triColors = triangleColors(m, indices ? indices.length / 3 : positions.length / 9);
  if (triColors) {
    const shared = indices ? vertexColors(indices, triColors, positions.length / 3) : null;
    if (shared) colors = shared;
    else if (indices) {
      // Faces meet at a shared vertex with different colours: one vertex per triangle corner.
      positions = expand(positions, indices);
      if (normals) normals = expand(normals, indices);
      colors = cornerColors(triColors, indices.length);
      indices = undefined;
    } else colors = cornerColors(triColors, positions.length / 3);
  }

  const mesh: MeshData = { name: m.name ?? "", positions, bounds: bounds(positions) };
  if (normals && normals.length === positions.length) mesh.normals = normals;
  if (indices) mesh.indices = indices;
  if (colors) mesh.colors = colors;
  return mesh;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** DEFAULT_COLOR in linear RGB, for uncoloured faces of an otherwise coloured mesh. */
const DEFAULT_LINEAR = [(DEFAULT_COLOR >> 16) & 255, (DEFAULT_COLOR >> 8) & 255, DEFAULT_COLOR & 255].map((c) => srgbToLinear(c / 255));

/** RGB per triangle (face colour, else mesh colour, else default), or null if nothing is coloured. */
function triangleColors(m: OcctMesh, triangles: number): Float32Array | null {
  const faces = (m.brep_faces ?? []).filter((f) => f.color);
  if (!m.color && faces.length === 0) return null;
  const out = new Float32Array(triangles * 3);
  const paint = (rgb: number[], first: number, last: number) => {
    const [r, g, b] = rgb;
    for (let t = Math.max(0, first); t <= Math.min(triangles - 1, last); t++) {
      out[t * 3] = r;
      out[t * 3 + 1] = g;
      out[t * 3 + 2] = b;
    }
  };
  paint(m.color ?? DEFAULT_LINEAR, 0, triangles - 1);
  for (const f of faces) paint(f.color!, f.first, f.last);
  return out;
}

/** Per-vertex colours for an indexed mesh, or null when a vertex would need two colours. */
function vertexColors(indices: Uint32Array, tri: Float32Array, vertexCount: number): Float32Array | null {
  const out = new Float32Array(vertexCount * 3);
  const set = new Uint8Array(vertexCount);
  for (let k = 0; k < indices.length; k++) {
    const v = indices[k];
    const t = (k / 3) | 0;
    const r = tri[t * 3], g = tri[t * 3 + 1], b = tri[t * 3 + 2];
    if (!set[v]) {
      set[v] = 1;
      out[v * 3] = r;
      out[v * 3 + 1] = g;
      out[v * 3 + 2] = b;
    } else if (out[v * 3] !== r || out[v * 3 + 1] !== g || out[v * 3 + 2] !== b) {
      return null;
    }
  }
  return out;
}

function cornerColors(tri: Float32Array, corners: number): Float32Array {
  const out = new Float32Array(corners * 3);
  for (let k = 0; k < corners; k++) {
    const t = (k / 3) | 0;
    out[k * 3] = tri[t * 3];
    out[k * 3 + 1] = tri[t * 3 + 1];
    out[k * 3 + 2] = tri[t * 3 + 2];
  }
  return out;
}

function expand(src: Float32Array, indices: Uint32Array): Float32Array {
  const out = new Float32Array(indices.length * 3);
  for (let k = 0; k < indices.length; k++) out.set(src.subarray(indices[k] * 3, indices[k] * 3 + 3), k * 3);
  return out;
}
