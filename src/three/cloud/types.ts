export interface CloudMeta {
  id: string; revision: number; count: number; originalCount: number; invalid: number; selected: number;
  origin: [number, number, number]; bounds: [number, number, number, number, number, number];
  dirty: boolean; preview: boolean; canUndo: boolean; canRedo: boolean; editable: boolean;
  warning: string | null; hasRgb: boolean; hasIntensity: boolean;
}
export type Region = { type: "box"; min: number[]; max: number[] } | { type: "polygon"; vertices: number[][] };
export type Operation = { type: "voxel"; size: number } | { type: "sor"; k: number; sigma: number }
  | { type: "radius"; radius: number; min: number }
  | { type: "select"; matrix: number[]; planes: number[][]; region: Region };
export type Action = { type: "open"; path: string } | { type: "filter"; operation: Operation }
  | { type: "crop"; keep: boolean } | { type: "apply" | "discardPreview" | "undo" | "redo" | "clearSelection" }
  | { type: "save"; path: string; overwrite: boolean };
export interface CloudDisplay { mode: "rgb" | "solid" | "height" | "intensity"; color: [number, number, number]; height: number[]; range: [number, number] }
export const CLOUD_CHUNK = 25_000;
export function editedPath(path: string): string { return path.replace(/\.(pcd|ply|las|laz)$/i, "_edited.$1"); }

const linear = Array.from({ length: 256 }, (_, v) => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
/** Bounded 500KB packets: xyz f32 LE, RGB u8, selection u8, source point ID u32 LE. */
export function decodeChunk(buffer: ArrayBuffer) {
  if (buffer.byteLength % 20 !== 0 || buffer.byteLength > CLOUD_CHUNK * 20) throw new Error("잘못된 점 청크");
  const n = buffer.byteLength / 20, view = new DataView(buffer);
  const positions = new Float32Array(n * 3), colors = new Float32Array(n * 3), pick = new Uint8Array(n * 3), selected = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const id = view.getUint32(i * 20 + 16, true) + 1;
    for (let a = 0; a < 3; a++) { positions[i * 3 + a] = view.getFloat32(i * 20 + a * 4, true); colors[i * 3 + a] = linear[view.getUint8(i * 20 + 12 + a)]; pick[i * 3 + a] = (id >> (a * 8)) & 255; }
    selected[i] = view.getUint8(i * 20 + 15);
  }
  return { positions, colors, pick, selected };
}
