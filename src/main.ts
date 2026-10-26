import "./styles.css";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { resolveViewer } from "./registry";
import { platform } from "./platform";
import { applyTheme, currentMode, cycleTheme } from "./theme";
import { isOpenKey, routeOpen } from "./open-route";

const app = document.getElementById("app")!;
const file = new URLSearchParams(location.search).get("file");

function message(title: string, hint?: string) {
  const box = document.createElement("div");
  box.className = "empty";
  const h = document.createElement("p");
  h.textContent = title;
  box.append(h);
  if (hint) {
    const s = document.createElement("p");
    s.className = "hint";
    s.textContent = hint;
    box.append(s);
  }
  app.replaceChildren(box);
}

async function show() {
  if (!file) {
    message("파일을 끌어다 놓거나 Ctrl+O");
    return;
  }
  // The OS title follows the file even when it cannot be shown (the viewer keeps it updated after).
  void platform.setWindowTitle(file.split(/[\\/]/).pop() ?? file).catch(() => {});
  const load = resolveViewer(file);
  if (!load) {
    message("지원하지 않는 형식", file);
    return;
  }
  try {
    const viewer = await load();
    await viewer.mount(app, file);
  } catch (e) {
    message("파일을 열 수 없습니다", String(e));
  }
}

function openPaths(paths: string[]) {
  const { here, windows } = routeOpen(file, paths);
  for (const p of windows) void platform.openWindow(p).catch((e) => platform.alert(String(e)).catch(() => {}));
  if (here) location.search = "?file=" + encodeURIComponent(here);
}

let picking = false; // one dialog at a time
async function pickAndOpen() {
  if (picking) return;
  picking = true;
  try {
    openPaths(await platform.pickFiles());
  } catch (e) {
    await platform.alert(String(e)).catch(() => {});
  } finally {
    picking = false;
  }
}

applyTheme(currentMode());
// Capture phase: the editor must not swallow app shortcuts.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t") {
      e.preventDefault();
      cycleTheme();
    } else if (isOpenKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      void pickAndOpen();
    }
  },
  true,
);

getCurrentWebview()
  .onDragDropEvent((ev) => {
    if (ev.payload.type === "drop") openPaths(ev.payload.paths);
  })
  .catch(() => {});

void show();
