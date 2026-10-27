// 3D viewer: full-window stage, toolbar, progress overlay and error banner. Loaded lazily by the
// registry, so three.js never reaches the entry or md chunks.
import "./core/three.css";
import type { Viewer } from "../registry";
import { formatOf } from "./formats";
import { Stage, WebGLUnavailableError } from "./core/stage";
import { adoptGltfScene, buildParsedFile, disposeObject, renderableSizes, type BuiltFile } from "./core/build-objects";
import { buildTree, type SceneFile, type SceneModel, type TreeNode } from "./core/scene-model";
import { keyAction, TOOLBAR, type KeyAction } from "./core/keys";
import { formatProgress, formatStatus, progressPercent, type Phase } from "./worker/protocol";
import { loadGltfFile, loadMeshFile } from "./load";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

/** User-facing (Korean) text for a load failure. */
export function describeLoadError(name: string, e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (e instanceof RangeError || /allocation failed|out of memory|invalid array length/i.test(text)) {
    return `${name}: 메모리가 부족해 열 수 없습니다. 파일이 너무 큽니다.`;
  }
  return `${name}: 파일을 열 수 없습니다. (${text})`;
}

class Progress {
  readonly root = el("div", "va3d-progress");
  private readonly name = el("span", "va3d-progress-name");
  private readonly phase = el("span", "va3d-progress-phase");
  private readonly bar = el("div", "va3d-bar");
  private readonly fill = el("div");

  constructor() {
    const text = el("div", "va3d-progress-text");
    text.append(this.name, this.phase);
    this.bar.append(this.fill);
    this.root.append(text, this.bar);
    this.root.hidden = true;
  }

  show(fileName: string, phase: Phase, loaded: number, total: number, note?: string): void {
    this.root.hidden = false;
    this.name.textContent = fileName;
    this.phase.textContent = formatProgress(phase, loaded, total, note);
    const percent = progressPercent(loaded, total);
    this.bar.classList.toggle("indeterminate", percent === null);
    this.fill.style.width = percent === null ? "" : `${percent}%`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

class Banner {
  readonly root = el("div", "va3d-banner");
  private readonly text = el("span");

  constructor() {
    const close = el("button");
    close.type = "button";
    close.textContent = "×";
    close.title = "닫기";
    close.addEventListener("click", () => (this.root.hidden = true));
    this.root.setAttribute("role", "alert");
    this.root.append(this.text, close);
    this.root.hidden = true;
  }

  show(message: string): void {
    this.text.textContent = message;
    this.root.hidden = false;
  }
}

class ThreeViewer {
  readonly model: SceneModel = { files: [] };
  readonly objects = new Map<string, BuiltFile>();
  private nextId = 1;
  private readonly progress = new Progress();
  private readonly banner = new Banner();
  /** Plain-text status line (bottom left): triangle count and load time of the last file. */
  private readonly status = el("div", "va3d-status");

  constructor(readonly stage: Stage, root: HTMLElement) {
    const toolbar = el("div", "va3d-toolbar");
    toolbar.setAttribute("role", "toolbar");
    for (const [action, label, tip] of TOOLBAR) {
      const b = el("button");
      b.type = "button";
      b.textContent = label;
      b.title = tip;
      b.addEventListener("click", () => this.run(action));
      toolbar.append(b);
    }
    this.status.setAttribute("role", "status");
    root.append(toolbar, this.progress.root, this.banner.root, this.status);
    window.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      this.run(action);
    });
  }

  run(action: KeyAction): void {
    if (action.type === "fit") this.stage.fitAll();
    else this.stage.setView(action.view);
  }

  /** Load one file into the scene; failures go to the banner. Returns the file id, or null. */
  async load(path: string, signal?: AbortSignal): Promise<string | null> {
    const name = baseName(path);
    const format = formatOf(path);
    const id = `f${this.nextId++}`;
    const started = performance.now();
    let workerUsed = true;
    const onProgress = (phase: Phase, loaded: number, total: number) =>
      this.progress.show(name, phase, loaded, total, workerUsed ? undefined : "워커 미사용");
    try {
      let root: TreeNode;
      let built: BuiltFile;
      if (format === "stl" || format === "obj" || format === "ply") {
        onProgress("read", 0, 0);
        const parsed = await loadMeshFile(path, format, onProgress, signal, () => (workerUsed = false));
        root = buildTree(parsed.tree, name, id, parsed.meshes.map((m) => m.name));
        built = buildParsedFile(parsed, root);
      } else if (format === "gltf" || format === "glb") {
        onProgress("read", 0, 0);
        const scene = await loadGltfFile(path, onProgress, signal);
        ({ root, built } = adoptGltfScene(scene, name, id));
      } else if (format === "step" || format === "iges") {
        this.banner.show(`${name}: STEP/IGES 지원은 준비 중입니다.`);
        return null;
      } else {
        this.banner.show(`${name}: 지원하지 않는 형식입니다.`);
        return null;
      }
      if (signal?.aborted) {
        disposeObject(built.group);
        return null;
      }
      const file: SceneFile = { id, path, name, format, sourceFrame: "as-is", sourceUnit: "as-is", root };
      this.model.files.push(file);
      this.objects.set(id, built);
      // Hidden until uploaded batch by batch; fit first so every batch lands in view.
      this.stage.add(built.group, built.renderables);
      if (this.model.files.length === 1) this.stage.fitAll("iso");
      await this.stage.reveal(built.renderables, renderableSizes(built.renderables), (k, n) => onProgress("upload", k, n), signal);
      this.status.textContent = formatStatus(built.triangles, performance.now() - started, workerUsed);
      return id;
    } catch (e) {
      if (!isAbort(e)) this.banner.show(describeLoadError(name, e));
      return null;
    } finally {
      this.progress.hide();
    }
  }
}

function showNotice(el: HTMLElement, title: string, hint: string): void {
  const box = document.createElement("div");
  box.className = "empty";
  const h = document.createElement("p");
  h.textContent = title;
  const s = document.createElement("p");
  s.className = "hint";
  s.textContent = hint;
  box.append(h, s);
  el.replaceChildren(box);
}

const viewer: Viewer = {
  async mount(host: HTMLElement, path: string): Promise<void> {
    const root = el("div", "va3d");
    const canvasHost = el("div", "va3d-canvas");
    root.append(canvasHost);
    host.replaceChildren(root);
    let stage: Stage;
    try {
      stage = new Stage(canvasHost);
    } catch (e) {
      if (!(e instanceof WebGLUnavailableError)) throw e;
      showNotice(host, "3D 뷰어를 열 수 없습니다: WebGL2를 사용할 수 없습니다", "그래픽 드라이버를 업데이트하거나 하드웨어 가속을 켜 주세요.");
      return;
    }
    const v = new ThreeViewer(stage, root);
    await v.load(path);
  },
};

export default viewer;
