import "./styles.css";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { resolveViewer } from "./registry";
import { platform } from "./platform";
import { applyTheme, currentMode, cycleTheme } from "./theme";

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
    message("파일을 끌어다 놓으세요");
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

applyTheme(currentMode());
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t") {
    e.preventDefault();
    cycleTheme();
  }
});

getCurrentWebview()
  .onDragDropEvent((ev) => {
    if (ev.payload.type !== "drop" || ev.payload.paths.length === 0) return;
    const [first, ...rest] = ev.payload.paths;
    if (file) {
      for (const p of ev.payload.paths) void platform.openWindow(p);
    } else {
      location.search = "?file=" + encodeURIComponent(first);
      for (const p of rest) void platform.openWindow(p);
    }
  })
  .catch(() => {});

void show();
