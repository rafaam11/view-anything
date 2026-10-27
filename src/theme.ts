export type ThemeMode = "system" | "light" | "dark";
const ORDER: ThemeMode[] = ["dark", "light", "system"];
const KEY = "va.theme";

export function nextMode(m: ThemeMode): ThemeMode {
  return ORDER[(ORDER.indexOf(m) + 1) % ORDER.length];
}

export function currentMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

export function applyTheme(mode: ThemeMode, persist = true): void {
  document.documentElement.dataset.theme = mode;
  try {
    if (persist) localStorage.setItem(KEY, mode);
  } catch {}
}

export function cycleTheme(): ThemeMode {
  // Use the displayed preference even if storage is unavailable.
  const shown = document.documentElement.dataset.theme;
  const m = nextMode(shown === "dark" || shown === "light" || shown === "system" ? shown : currentMode());
  applyTheme(m);
  return m;
}

/** Persist across restarts and keep already-open viewer windows in sync. */
export function initializeTheme(): () => void {
  applyTheme(currentMode());
  const sync = (e: StorageEvent) => {
    if (e.key !== KEY && e.key !== null) return;
    if (e.storageArea && e.storageArea !== localStorage) return;
    const mode = e.newValue;
    applyTheme(mode === "dark" || mode === "light" ? mode : "system", false);
  };
  window.addEventListener("storage", sync);
  return () => window.removeEventListener("storage", sync);
}
