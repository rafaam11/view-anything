import "./styles.css";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { resolveViewer, type Viewer } from "./registry";
import { platform } from "./platform";
import { applyTheme, currentMode, cycleTheme } from "./theme";
import { isOpenKey, OPEN_EVENT, routeDrop, type OpenEventDetail, type WindowKind } from "./open-route";
import { isThreeD } from "./three/formats";

const app = document.getElementById("app")!;
let file = new URLSearchParams(location.search).get("file");
/** What the window shows; decides where dropped and picked files go. */
let kind: WindowKind = file ? kindOf(file) : "empty";
/** The mounted viewer (null while mounting, or when the file could not be shown). */
let viewer: Viewer | null = null;

function kindOf(path: string): WindowKind {
  // Anything that is not a 3D model (md, unsupported, ...) keeps the v0.1 rule: new windows.
  return isThreeD(path) ? "3d" : "md";
}

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
    const v = await load();
    await v.mount(app, file);
    viewer = v;
  } catch (e) {
    message("파일을 열 수 없습니다", String(e));
  }
}

/** Settles once the current file is mounted (or failed to). */
let ready = show();
void ready.then(() => import("./update/main")).then((m) => m.startUpdater()).catch((e) => console.warn("updater initialization failed", e));

function openWindows(paths: string[]) {
  for (const p of paths) void platform.openWindow(p).catch((e) => platform.alert(String(e)).catch(() => {}));
}

async function openPaths(paths: string[], shift: boolean) {
  const route = routeDrop(kind, paths, shift);
  const windows = [...route.windows];
  if (route.here) {
    if (kindOf(route.here) === "3d") {
      // An empty window becomes a 3D window in place (no reload), so the rest can be appended.
      file = route.here;
      kind = "3d";
      history.replaceState(history.state, "", "?file=" + encodeURIComponent(route.here));
      ready = show();
    } else {
      openWindows(windows);
      location.search = "?file=" + encodeURIComponent(route.here);
      return;
    }
  }
  // New windows never wait for this window's viewer (it may still be mounting).
  openWindows(windows);
  if (route.append.length > 0) {
    await ready;
    openWindows(viewer?.accept?.(route.append, { newWindow: false }) ?? route.append);
  }
}

/**
 * Shift as the drop happened: the OS state where available, else the last key events seen.
 * The fallback rarely helps: during an OS (OLE) drag the webview gets no key events, so it only
 * knows Shift if it was pressed while the window had focus before the drag. On Windows the OS
 * answer is always there; elsewhere Shift-drop is best-effort.
 */
let shiftHeld = false;
async function shiftState(): Promise<boolean> {
  try {
    const os = await platform.modifierShift();
    if (os !== null) return os;
  } catch {
    // fall through to the tracked state
  }
  return shiftHeld;
}
const trackShift = (e: KeyboardEvent) => (shiftHeld = e.shiftKey);
window.addEventListener("keydown", trackShift, true);
window.addEventListener("keyup", trackShift, true);
window.addEventListener("blur", () => (shiftHeld = false));

let picking = false; // one dialog at a time
/** Ctrl+O / 파일 > 열기 (routed like a drop); `append`: 파일 > 장면에 추가 (3D files into this scene). */
async function pickAndOpen(append = false) {
  if (picking) return;
  picking = true;
  let paths: string[];
  try {
    paths = await platform.pickFiles({ only3d: append });
  } catch (e) {
    await platform.alert(String(e)).catch(() => {});
    return;
  } finally {
    picking = false; // the dialog is closed; routing below must not block the next Ctrl+O
  }
  const run = append && kind === "3d" ? appendPaths(paths) : openPaths(paths, false);
  await run.catch((e) => platform.alert(String(e)).catch(() => {}));
}

/** Every picked 3D file goes into this window's scene (no Shift, no routing); anything else opens a window. */
async function appendPaths(paths: string[]) {
  await ready;
  openWindows(viewer?.accept?.(paths, { newWindow: false }) ?? paths);
}

window.addEventListener(OPEN_EVENT, (e) => {
  const detail = (e as CustomEvent<OpenEventDetail>).detail;
  void pickAndOpen(detail?.append === true);
});

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
      if (!e.repeat) void pickAndOpen(); // a held key must not queue dialogs
    }
  },
  true,
);

getCurrentWebview()
  .onDragDropEvent((ev) => {
    if (ev.payload.type !== "drop") return;
    const paths = ev.payload.paths;
    void shiftState()
      .then((shift) => openPaths(paths, shift))
      .catch((e) => platform.alert(String(e)).catch(() => {}));
  })
  .catch(() => {});
