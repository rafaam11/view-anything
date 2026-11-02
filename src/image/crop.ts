/** Crop geometry in current-canvas pixels. No DOM, so every rule here is unit tested. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
/** `new`: draw a fresh rectangle, `move`: drag the current one, a handle: resize from that edge. */
export type CropDrag = "new" | "move" | Handle;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Client coordinates to image pixels, given the image element's on-screen box. */
export function toImagePoint(client: Point, box: { left: number; top: number; width: number; height: number }, image: Size): Point {
  const x = box.width ? (client.x - box.left) / box.width : 0, y = box.height ? (client.y - box.top) / box.height : 0;
  return { x: clamp(Math.round(x * image.width), 0, image.width), y: clamp(Math.round(y * image.height), 0, image.height) };
}

/** Integer rectangle of at least one pixel that lies inside the image. */
export function clampRect(rect: Rect, image: Size): Rect {
  const round = (v: number) => Number.isFinite(v) ? Math.round(v) : 0;
  const width = clamp(round(rect.width), 1, image.width), height = clamp(round(rect.height), 1, image.height);
  return { x: clamp(round(rect.x), 0, image.width - width), y: clamp(round(rect.y), 0, image.height - height), width, height };
}

/**
 * For typed values: the origin the user typed stays and the size gives way. `clampRect` does the
 * opposite, which suits drags but would undo a typed X while the rectangle is still full width.
 */
export function fitRect(rect: Rect, image: Size): Rect {
  const round = (v: number) => Number.isFinite(v) ? Math.round(v) : 0;
  const x = clamp(round(rect.x), 0, image.width - 1), y = clamp(round(rect.y), 0, image.height - 1);
  return { x, y, width: clamp(round(rect.width), 1, image.width - x), height: clamp(round(rect.height), 1, image.height - y) };
}

/**
 * What a press at `point` grabs. `tolerance` is in image pixels (callers convert the on-screen grab
 * size through the zoom). The whole-image rectangle has its edges on the image border, so only a
 * press near the border resizes it and anywhere else draws a new rectangle.
 */
export function hitTest(point: Point, rect: Rect, image: Size, tolerance: number): CropDrag {
  const left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
  const withinX = point.x >= left - tolerance && point.x <= right + tolerance;
  const withinY = point.y >= top - tolerance && point.y <= bottom + tolerance;
  const nearLeft = withinY && Math.abs(point.x - left) <= tolerance, nearRight = withinY && Math.abs(point.x - right) <= tolerance;
  const nearTop = withinX && Math.abs(point.y - top) <= tolerance, nearBottom = withinX && Math.abs(point.y - bottom) <= tolerance;
  // A rectangle narrower than the grab zone resolves to the nearer edge, keeping both reachable.
  const horizontal = nearLeft && nearRight ? (point.x - left <= right - point.x ? "w" : "e") : nearLeft ? "w" : nearRight ? "e" : "";
  const vertical = nearTop && nearBottom ? (point.y - top <= bottom - point.y ? "n" : "s") : nearTop ? "n" : nearBottom ? "s" : "";
  if (horizontal || vertical) return (vertical + horizontal) as Handle;
  const whole = rect.x === 0 && rect.y === 0 && rect.width === image.width && rect.height === image.height;
  const inside = point.x > left && point.x < right && point.y > top && point.y < bottom;
  return inside && !whole ? "move" : "new";
}

/** The rectangle after dragging from `start` to `point`; `rect` is the rectangle at press time. */
export function dragRect(kind: CropDrag, start: Point, point: Point, rect: Rect, image: Size): Rect {
  if (kind === "new") {
    return clampRect({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) }, image);
  }
  const dx = point.x - start.x, dy = point.y - start.y;
  if (kind === "move") return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, image);
  let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
  if (kind.includes("w")) left = clamp(left + dx, 0, image.width);
  if (kind.includes("e")) right = clamp(right + dx, 0, image.width);
  if (kind.includes("n")) top = clamp(top + dy, 0, image.height);
  if (kind.includes("s")) bottom = clamp(bottom + dy, 0, image.height);
  // Dragging an edge past the opposite one mirrors the rectangle instead of collapsing it.
  return clampRect({ x: Math.min(left, right), y: Math.min(top, bottom), width: Math.abs(right - left), height: Math.abs(bottom - top) }, image);
}
