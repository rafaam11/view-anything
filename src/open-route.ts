import { isThreeD } from "./three/formats";

/**
 * Where opened files go (Ctrl+O and drag-and-drop): an empty window shows the first file itself,
 * a window that already shows a document is never replaced (nothing unsaved can be lost), so
 * everything else gets its own window.
 */
export function routeOpen(currentFile: string | null, paths: string[]): { here: string | null; windows: string[] } {
  if (paths.length === 0) return { here: null, windows: [] };
  if (currentFile) return { here: null, windows: [...paths] };
  const [first, ...rest] = paths;
  return { here: first, windows: rest };
}

export type WindowKind = "empty" | "md" | "3d";

/**
 * Where dropped (or Ctrl+O-picked) files go, by what the window shows:
 * - md (or any non-3D document): every file opens a new window (v0.1 rule).
 * - 3d: 3D files are appended to the scene, other files open new windows; with Shift, 3D files
 *   open new windows too.
 * - empty: the first file opens here; if it is a 3D file, the other 3D files of the same drop are
 *   appended (not with Shift). Everything else opens new windows.
 */
export function routeDrop(current: WindowKind, paths: string[], shift: boolean): { here?: string; append: string[]; windows: string[] } {
  if (current === "md") return { append: [], windows: [...paths] };
  if (current === "3d") {
    if (shift) return { append: [], windows: [...paths] };
    return { append: paths.filter(isThreeD), windows: paths.filter((p) => !isThreeD(p)) };
  }
  if (paths.length === 0) return { append: [], windows: [] };
  const [here, ...rest] = paths;
  if (!isThreeD(here) || shift) return { here, append: [], windows: rest };
  return { here, append: rest.filter(isThreeD), windows: rest.filter((p) => !isThreeD(p)) };
}

/** OS window title for the files a window shows: one name, or "<first> 외 N개". */
export function windowTitle(names: readonly string[]): string {
  if (names.length === 0) return "view-anything";
  if (names.length === 1) return names[0];
  return `${names[0]} 외 ${names.length - 1}개`;
}

/** Ctrl+O, including auto-repeat (the caller swallows repeats but only acts on the first press). */
export function isOpenKey(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "o";
}
