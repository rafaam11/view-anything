import { platform } from "./platform";

/**
 * The native window is the source of truth (the titlebar re-reads it on mount and on resize, so it
 * survives page reloads); `data-fullscreen` lets CSS and key handlers follow it.
 */
export const isFullscreen = () => document.documentElement.dataset.fullscreen === "true";

export function reflectFullscreen(on: boolean): void {
  if (on) document.documentElement.dataset.fullscreen = "true";
  else delete document.documentElement.dataset.fullscreen;
}

export async function toggleFullscreen(): Promise<void> {
  const on = !isFullscreen();
  reflectFullscreen(on);
  try {
    await platform.setFullscreen(on);
  } catch (e) {
    reflectFullscreen(!on);
    throw e;
  }
}
