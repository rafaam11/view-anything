import { THREE_D_EXTENSIONS } from "./three/formats";
import { TEXT_EXTENSIONS } from "./text/formats";

export type Viewer = {
  mount(el: HTMLElement, path: string): Promise<void>;
  /**
   * Files dropped (or Ctrl+O-picked) onto a window that shows this viewer. Returns the paths it
   * did not take; those open in new windows. `newWindow` (Shift-drop): take nothing. Viewers
   * without it never take files (md: every file opens a new window).
   */
  accept?(paths: string[], opts: { newWindow: boolean }): string[];
};

const viewers: Record<string, () => Promise<Viewer>> = {};
const loadText = () => import("./text/viewer").then(m => m.default);
for (const ext of TEXT_EXTENSIONS) viewers[ext] = loadText;
const loadMd = () => import("./md/viewer").then((m) => m.default);
viewers["md"] = loadMd;
viewers["markdown"] = loadMd;
viewers["csv"] = () => import("./data/csv-viewer").then((m) => m.default);
viewers["pdf"] = () => import("./pdf/viewer").then((m) => m.default);
const loadStructured = () => import("./data/structured-viewer").then((m) => m.default);
for (const ext of ["json", "yaml", "yml"]) viewers[ext] = loadStructured;
const loadImage = () => import("./image/viewer").then((m) => m.default);
for (const ext of ["png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"]) viewers[ext] = loadImage;
// three.js stays out of the entry chunk: the 3D viewer is only reached through this import.
const load3d = () => import("./three/viewer").then((m) => m.default);
for (const ext of THREE_D_EXTENSIONS) viewers[ext] = load3d;

export function resolveViewer(path: string): (() => Promise<Viewer>) | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(viewers, ext) ? viewers[ext] : null;
}
