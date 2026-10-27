import { getCurrentWindow, type Window as AppWindow } from "@tauri-apps/api/window";
import { currentMode, cycleTheme, nextMode, type ThemeMode } from "./theme";
import "./titlebar.css";

type WindowControls = Pick<AppWindow, "minimize" | "toggleMaximize" | "close" | "isMaximized" | "onResized" | "setTheme">;

// Static application icons only. File names and other external strings use textContent.
const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${body}</svg>`;
const icons = {
  dark: svg('<path d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z"/>'),
  light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'),
  system: svg('<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M12 17v4m-4 0h8"/>'),
  minimize: svg('<path d="M6 12h12"/>'),
  maximize: svg('<rect x="6" y="6" width="12" height="12"/>'),
  restore: svg('<path d="M9 6V4h11v11h-2"/><rect x="4" y="9" width="11" height="11"/>'),
  close: svg('<path d="m6 6 12 12M6 18 18 6"/>'),
};
const names: Record<ThemeMode, string> = { dark: "다크 모드", light: "라이트 모드", system: "시스템 설정" };

/** App-only chrome; the standalone HTML viewer never imports this module. */
export function mountTitlebar(host: HTMLElement = document.body, appWindow: WindowControls = getCurrentWindow()): () => void {
  const bar = document.createElement("header");
  bar.className = "va-titlebar";
  bar.setAttribute("aria-label", "창 제목 표시줄");
  const drag = document.createElement("div");
  drag.className = "va-titlebar-drag";
  // Tauri implements native drag and double-click maximize on these elements.
  // Never mark the buttons (or their parent) as a drag region.
  drag.setAttribute("data-tauri-drag-region", "");
  const title = document.createElement("span");
  title.className = "va-titlebar-title";
  title.setAttribute("data-tauri-drag-region", "");
  drag.append(title);
  const controls = document.createElement("div");
  controls.className = "va-titlebar-controls";
  const report = (e: unknown) => console.warn("window control failed", e);
  const button = (action: string, label: string, icon: string, run: () => void | Promise<void>) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.action = action;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = icon;
    b.addEventListener("click", () => { void Promise.resolve().then(run).catch(report); });
    controls.append(b);
    return b;
  };
  const theme = button("theme", "테마", icons.system, () => { cycleTheme(); });
  theme.setAttribute("aria-keyshortcuts", "Control+Shift+T");
  button("minimize", "최소화", icons.minimize, () => appWindow.minimize());
  const maximize = button("maximize", "최대화", icons.maximize, async () => {
    await appWindow.toggleMaximize();
    await updateMaximized();
  });
  // close(), not destroy(): the existing unsaved-edit guards must be allowed to veto.
  button("close", "닫기", icons.close, () => appWindow.close());
  bar.append(drag, controls);
  host.prepend(bar);

  let disposed = false;
  let resizeVersion = 0;
  async function updateMaximized() {
    const version = ++resizeVersion;
    const max = await appWindow.isMaximized();
    if (disposed || version !== resizeVersion) return;
    maximize.title = max ? "이전 크기로 복원" : "최대화";
    maximize.setAttribute("aria-label", maximize.title);
    maximize.innerHTML = max ? icons.restore : icons.maximize;
  }
  const updateTitle = () => { title.textContent = document.title || "view-anything"; };
  const titleObserver = new MutationObserver(updateTitle);
  titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  updateTitle();

  let lastMode: ThemeMode | undefined;
  const updateTheme = () => {
    const mode = document.documentElement.dataset.theme as ThemeMode | undefined;
    const selected = mode === "dark" || mode === "light" || mode === "system" ? mode : currentMode();
    if (selected === lastMode) return;
    lastMode = selected;
    theme.dataset.mode = selected;
    theme.innerHTML = icons[selected];
    theme.title = `${names[selected]} · 클릭: ${names[nextMode(selected)]} (Ctrl+Shift+T)`;
    theme.setAttribute("aria-label", theme.title);
    void appWindow.setTheme(selected === "system" ? null : selected).catch(report);
  };
  const themeObserver = new MutationObserver(updateTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  updateTheme();
  void updateMaximized().catch(report);
  let unlisten: (() => void) | undefined;
  void appWindow.onResized(() => { void updateMaximized().catch(report); }).then((stop) => {
    if (disposed) stop();
    else unlisten = stop;
  }).catch(report);

  return () => {
    if (disposed) return;
    disposed = true;
    unlisten?.();
    titleObserver.disconnect();
    themeObserver.disconnect();
    bar.remove();
  };
}
