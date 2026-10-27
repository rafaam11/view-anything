// Messages between the UI thread and the mesh-parse worker, plus progress helpers. Pure: no
// three.js, no Tauri, so both sides (and node tests) can import it.
import type { ParsedTree } from "../core/scene-model";

export type MeshFormat = "stl" | "obj" | "ply";
export type Primitive = "triangles" | "lines" | "points";
export type Phase = "read" | "parse";

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

/** Every distinct ArrayBuffer in `file` (a buffer may not appear twice in a transfer list). */
export function transferables(file: ParsedFile): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  for (const m of file.meshes) {
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

const PHASE_LABEL: Record<Phase, string> = { read: "읽는 중", parse: "해석 중" };

/** "읽는 중 42%", "읽는 중 12.3 MB" (unknown total), "해석 중". */
export function formatProgress(phase: Phase, loaded: number, total: number): string {
  const percent = progressPercent(loaded, total);
  if (percent !== null) return `${PHASE_LABEL[phase]} ${percent}%`;
  if (loaded > 0) return `${PHASE_LABEL[phase]} ${(loaded / (1 << 20)).toFixed(1)} MB`;
  return PHASE_LABEL[phase];
}
