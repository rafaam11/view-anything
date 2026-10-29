export type FontPreset = "system" | "serif" | "mono";
export interface Preferences { mdFont: FontPreset; mdSize: number; textFont: FontPreset; textSize: number; textWrap: boolean }
export const DEFAULTS: Preferences = { mdFont: "system", mdSize: 16, textFont: "mono", textSize: 14, textWrap: true };
export const KEY = "va.preferences.v1";
export const FONTS: Record<FontPreset, string> = {
  system: 'system-ui, "Segoe UI", "Malgun Gothic", sans-serif',
  serif: '"Batang", "Noto Serif CJK KR", "Noto Serif", serif',
  mono: '"Cascadia Mono", "Cascadia Code", Consolas, "D2Coding", monospace',
};
export function parsePreferences(raw: string | null): Preferences {
  try {
    const p = JSON.parse(raw ?? "null");
    return {
      mdFont: p?.mdFont === "serif" || p?.mdFont === "mono" ? p.mdFont : "system",
      mdSize: Number.isInteger(p?.mdSize) && p.mdSize >= 12 && p.mdSize <= 24 ? p.mdSize : 16,
      textFont: p?.textFont === "system" || p?.textFont === "serif" ? p.textFont : "mono",
      textSize: Number.isInteger(p?.textSize) && p.textSize >= 12 && p.textSize <= 24 ? p.textSize : 14,
      textWrap: typeof p?.textWrap === "boolean" ? p.textWrap : true,
    };
  } catch { return { ...DEFAULTS }; }
}
let current: Preferences = { ...DEFAULTS };
export const preferences = () => ({ ...current });
export function applyPreferences(p: Partial<Preferences>, persist = true): boolean {
  current = parsePreferences(JSON.stringify({ ...current, ...p }));
  document.documentElement.style.setProperty("--va-md-font", FONTS[current.mdFont]);
  document.documentElement.style.setProperty("--va-md-size", `${current.mdSize}px`);
  document.documentElement.style.setProperty("--va-text-font", FONTS[current.textFont]);
  document.documentElement.style.setProperty("--va-text-size", `${current.textSize}px`);
  let saved = true;
  if (persist) { try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { saved = false; } }
  window.dispatchEvent(new Event("va:preferences"));
  return saved;
}
export function initializePreferences(): () => void {
  let raw: string | null = null; try { raw = localStorage.getItem(KEY); } catch {}
  applyPreferences(parsePreferences(raw), false);
  const sync = (e: StorageEvent) => { if (e.key === KEY || e.key === null) applyPreferences(parsePreferences(e.newValue), false); };
  window.addEventListener("storage", sync);
  return () => window.removeEventListener("storage", sync);
}
