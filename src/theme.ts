export type ThemeMode = "system" | "light" | "dark";
const ORDER: ThemeMode[] = ["system", "light", "dark"];
const KEY = "va-theme";

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

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
}

export function cycleTheme(): ThemeMode {
  const m = nextMode(currentMode());
  applyTheme(m);
  return m;
}
