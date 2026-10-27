// Keyboard shortcuts of the 3D stage. Uses KeyboardEvent.code so a Korean IME layout still works.
import type { StandardView } from "./views";

export type KeyAction = { type: "fit" } | { type: "view"; view: StandardView };

const DIGIT_VIEWS: readonly StandardView[] = ["front", "back", "left", "right", "top", "bottom", "iso"];

export function keyAction(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "metaKey">): KeyAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.code === "KeyF") return { type: "fit" };
  const m = /^(?:Digit|Numpad)([1-7])$/.exec(e.code);
  return m ? { type: "view", view: DIGIT_VIEWS[Number(m[1]) - 1] } : null;
}

/** Toolbar entries in display order: [action, label, tooltip]. */
export const TOOLBAR: readonly [KeyAction, string, string][] = [
  [{ type: "fit" }, "맞춤", "전체 맞춤 (F)"],
  [{ type: "view", view: "front" }, "앞", "앞 (1)"],
  [{ type: "view", view: "back" }, "뒤", "뒤 (2)"],
  [{ type: "view", view: "left" }, "좌", "왼쪽 (3)"],
  [{ type: "view", view: "right" }, "우", "오른쪽 (4)"],
  [{ type: "view", view: "top" }, "위", "위 (5)"],
  [{ type: "view", view: "bottom" }, "아래", "아래 (6)"],
  [{ type: "view", view: "iso" }, "등각", "등각 (7)"],
];
