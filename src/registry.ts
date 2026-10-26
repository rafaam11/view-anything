export type Viewer = { mount(el: HTMLElement, path: string): Promise<void> };

const viewers: Record<string, () => Promise<Viewer>> = {};
const loadMd = () => import("./md/viewer").then((m) => m.default);
viewers["md"] = loadMd;
viewers["markdown"] = loadMd;

export function resolveViewer(path: string): (() => Promise<Viewer>) | null {
  const name = path.split(/[\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return viewers[name.slice(dot + 1).toLowerCase()] ?? null;
}
