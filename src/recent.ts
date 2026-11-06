/**
 * Recently opened files, newest first, shared by every window through localStorage. No DOM: the
 * menu and the empty window render it (src/ui/recent-menu.ts). Paths stay on this machine; the
 * list can be cleared from the same menu.
 */
export const RECENT_KEY = "va.recent.v1";
export const MAX_RECENT = 20;
const CHANGE_EVENT = "va:recent";

export function parseRecent(raw: string | null): string[] {
  try {
    const list: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    for (const item of list) if (typeof item === "string" && item && !seen.has(item)) seen.add(item);
    return [...seen].slice(0, MAX_RECENT);
  } catch { return []; }
}

export function recentFiles(): string[] {
  try { return parseRecent(localStorage.getItem(RECENT_KEY)); } catch { return []; }
}

function store(list: string[]): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch { /* storage unavailable: nothing to remember */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function addRecent(path: string): void {
  store([path, ...recentFiles().filter((p) => p !== path)]);
}

export function removeRecent(path: string): void {
  store(recentFiles().filter((p) => p !== path));
}

export function clearRecent(): void {
  store([]);
}

/** Changes made in this window (a custom event) or in another one (the storage event). */
export function onRecentChange(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === RECENT_KEY || e.key === null) cb(); };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(CHANGE_EVENT, cb); window.removeEventListener("storage", onStorage); };
}
