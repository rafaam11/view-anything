import { THREE_D_EXTENSIONS } from "./three/formats";

export type Viewer = { mount(el: HTMLElement, path: string): Promise<void> };

const viewers: Record<string, () => Promise<Viewer>> = {};
const loadMd = () => import("./md/viewer").then((m) => m.default);
viewers["md"] = loadMd;
viewers["markdown"] = loadMd;
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
