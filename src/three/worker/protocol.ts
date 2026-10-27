// Messages between the UI thread and the mesh-parse worker, plus progress helpers. Pure: no
// three.js, no Tauri, so both sides (and node tests) can import it.
import type { ParsedTree } from "../core/scene-model";

export type MeshFormat = "stl" | "obj" | "ply";
export type Primitive = "triangles" | "lines" | "points";
/** read/parse: bytes or nothing; upload: chunks put on the GPU so far / total chunks. */
export type Phase = "read" | "parse" | "upload";

export interface MeshData {
  name: string;
  positions: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
  /** Linear RGB, 3 floats per vertex. */
  colors?: Float32Array;
  /** Default "triangles". */
  primitive?: Primitive;
  /** Axis-aligned bounds [minX, minY, minZ, maxX, maxY, maxZ], computed in the worker. */
  bounds?: number[];
  /**
   * Large meshes arrive split into pieces (one tree node, several draw objects) so the UI can upload
   * them a frame at a time. When set, the top-level arrays are empty; use `meshPieces`.
   */
  chunks?: MeshData[];
}

export interface ParsedFile {
  tree: ParsedTree;
  meshes: MeshData[];
}

/** UI -> worker. `parse` makes the worker fetch `url` itself; `buffer` hands it the bytes. */
export type ToWorker =
  | { type: "parse"; id: number; url: string; format: MeshFormat }
  | { type: "buffer"; id: number; format: MeshFormat; buffer: ArrayBuffer };

/** Worker -> UI. `need-buffer`: the worker's fetch failed; the UI should read the file and send `buffer`. */
export type FromWorker =
  | { type: "progress"; id: number; phase: Phase; loaded: number; total: number }
  | { type: "need-buffer"; id: number; message: string }
  | { type: "done"; id: number; file: ParsedFile }
  | { type: "error"; id: number; message: string };

/** The draw pieces of a mesh: its chunks, or the mesh itself. */
export function meshPieces(m: MeshData): MeshData[] {
  return m.chunks ?? [m];
}

/** Every distinct ArrayBuffer in `file` (a buffer may not appear twice in a transfer list). */
export function transferables(file: ParsedFile): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  for (const m of file.meshes.flatMap(meshPieces)) {
    for (const a of [m.positions, m.normals, m.indices, m.colors]) {
      if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer);
    }
  }
  return [...set];
}

/** Integer percent 0..100 (rounded down), or null while the total is unknown. */
export function progressPercent(loaded: number, total: number): number | null {
  if (!(total > 0)) return null;
  return Math.min(100, Math.max(0, Math.floor((loaded / total) * 100)));
}

const UNKNOWN_STEP = 4 << 20; // 4 MiB

/**
 * Wraps `emit` so it only fires when something visible changes: a new phase, a new integer
 * percent, or (total unknown) another 4 MiB read. Keeps postMessage traffic low for big files.
 */
export function progressThrottle(emit: (phase: Phase, loaded: number, total: number) => void) {
  let lastPhase: Phase | null = null;
  let lastPercent: number | null = null;
  let lastLoaded = -1;
  return (phase: Phase, loaded: number, total: number): void => {
    const percent = progressPercent(loaded, total);
    let changed: boolean;
    if (phase !== lastPhase) changed = true;
    else if (percent !== null) changed = percent !== lastPercent;
    else changed = lastPercent !== null || loaded - lastLoaded >= UNKNOWN_STEP;
    if (!changed) return;
    lastPhase = phase;
    lastPercent = percent;
    lastLoaded = loaded;
    emit(phase, loaded, total);
  };
}

const PHASE_LABEL: Record<Phase, string> = { read: "읽는 중", parse: "해석 중", upload: "GPU 업로드" };

/** "읽는 중 42%", "읽는 중 12.3 MB" (unknown total), "해석 중", "GPU 업로드 3/6"; optional " · note". */
export function formatProgress(phase: Phase, loaded: number, total: number, note?: string): string {
  const percent = progressPercent(loaded, total);
  let text: string;
  if (phase === "upload" && total > 0) text = `${PHASE_LABEL[phase]} ${loaded}/${total}`;
  else if (percent !== null) text = `${PHASE_LABEL[phase]} ${percent}%`;
  else if (loaded > 0) text = `${PHASE_LABEL[phase]} ${(loaded / (1 << 20)).toFixed(1)} MB`;
  else text = PHASE_LABEL[phase];
  return note ? `${text} · ${note}` : text;
}

/** Status line after a load: "삼각형 6,000,000 · 2.4초" (+ " · 워커 미사용" when the worker did not run). */
export function formatStatus(triangles: number, ms: number, workerUsed: boolean): string {
  const text = `삼각형 ${triangles.toLocaleString("en-US")} · ${(ms / 1000).toFixed(1)}초`;
  return workerUsed ? text : `${text} · 워커 미사용`;
}
