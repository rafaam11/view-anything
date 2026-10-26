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

/** Ctrl+O, first press only (a held key must not queue dialogs). */
export function isOpenKey(e: KeyboardEvent): boolean {
  return !e.repeat && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "o";
}
