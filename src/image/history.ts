/** Orthogonal transforms map the unchanged source into the current canvas.
 * History stores only dimensions and six integers, never full pixel snapshots. */
export interface ImageState {
  width: number;
  height: number;
  matrix: [number, number, number, number, number, number];
}
export type ImageEdit = { kind: "rotate" } | { kind: "flip" } | { kind: "crop"; x: number; y: number; width: number; height: number };

export function transformImage(state: ImageState, edit: ImageEdit): ImageState {
  const { width: w, height: h, matrix: [a, b, c, d, e, f] } = state;
  if (edit.kind === "rotate") return { width: h, height: w, matrix: [-b, a, -d, c, h - f, e] };
  if (edit.kind === "flip") return { width: w, height: h, matrix: [-a, b, -c, d, w - e, f] };
  const { x, y, width, height } = edit;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > w || y + height > h) {
    throw new Error("자르기 영역이 이미지 범위를 벗어났습니다.");
  }
  return { width, height, matrix: [a, b, c, d, e - x, f - y] };
}

export class ImageHistory {
  private entries: { id: number; state: ImageState }[];
  private index = 0;
  private nextId = 1;
  private savedId = 0;
  constructor(width: number, height: number) {
    this.entries = [{ id: 0, state: { width, height, matrix: [1, 0, 0, 1, 0, 0] } }];
  }
  get state(): ImageState { return this.entries[this.index].state; }
  get original(): boolean { return this.entries[this.index].id === 0; }
  get dirty(): boolean { return this.entries[this.index].id !== this.savedId; }
  get previous(): ImageState | undefined { return this.entries[this.index - 1]?.state; }
  get next(): ImageState | undefined { return this.entries[this.index + 1]?.state; }
  commit(state: ImageState): void {
    this.entries.splice(this.index + 1);
    this.entries.push({ id: this.nextId++, state });
    if (this.entries.length > 21) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  undo(): void { if (this.previous) this.index--; }
  redo(): void { if (this.next) this.index++; }
  markSaved(): void { this.savedId = this.entries[this.index].id; }
}
