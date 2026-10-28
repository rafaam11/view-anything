// 3D viewer: full-window stage, toolbar, progress overlay and error banner. Loaded lazily by the
// registry, so three.js never reaches the entry or md chunks.
import "./core/three.css";
import type { Viewer } from "../registry";
import { formatOf, isThreeD } from "./formats";
import { platform } from "../platform";
import { OPEN_EVENT, windowTitle, type OpenEventDetail } from "../open-route";
import { Stage, WebGLUnavailableError } from "./core/stage";
import { adoptGltfScene, buildParsedFile, disposeObject, renderableSizes, type BuiltFile } from "./core/build-objects";
import { buildTree, findNode, fixedSourceUnit, removeFile, setVisible, type SceneFile, type SceneModel, type TreeNode } from "./core/scene-model";
import { FRAME_LABELS, FRAME_PRESETS, FRAME_SHORT_LABELS, UNIT_LABELS, UNITS, type FramePreset, type ObjectFrame, type Unit } from "./core/frames";
import { ScenePanel } from "./core/panel";
import { ViewTools } from "./core/view-tools";
import { keyAction, type KeyAction } from "./core/keys";
import { Menubar } from "./core/menubar";
import { buildToolbar, focusCanvas, navigationSelect, viewMenuItems } from "./core/view-menu";
import { formatProgress, formatStatus, progressPercent, RetryableCadError, type Phase } from "./worker/protocol";
import { canCoarsen } from "./worker/cad-params";
import { loadGltfFile, loadMeshFile } from "./load";
import { workerRunner } from "./geometry-worker";
import type { CloudController } from "./cloud/controller";
import { pointCount } from "./core/info";

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
  if (e instanceof RetryableCadError) return `${name}: 파일이 너무 크거나 손상됨. (${text})`;
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
    const percent = phase === "tessellate" ? null : progressPercent(loaded, total);
    this.root.classList.toggle("spinning", phase === "tessellate");
    this.bar.classList.toggle("indeterminate", percent === null);
    this.fill.style.width = percent === null ? "" : `${percent}%`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export interface BannerAction {
  label: string;
  run: () => void;
}

/** Longest banner text, in characters (longer messages are cut with "…"). */
const BANNER_MAX = 300;

export class Banner {
  readonly root = el("div", "va3d-banner");
  private readonly text = el("span");
  private readonly action = el("button", "va3d-banner-action");
  private onAction: (() => void) | null = null;

  constructor() {
    const close = el("button");
    close.type = "button";
    close.textContent = "×";
    close.title = "닫기";
    close.addEventListener("click", () => (this.root.hidden = true));
    this.action.type = "button";
    this.action.addEventListener("click", () => {
      const run = this.onAction;
      this.onAction = null;
      this.root.hidden = true;
      run?.();
    });
    this.root.setAttribute("role", "alert");
    this.root.append(this.text, close);
    this.root.hidden = true;
  }

  /** Show `message`, optionally with one action button (e.g. a retry) that also closes the banner. */
  show(message: string, action?: BannerAction): void {
    // Worker and occt errors can be long (stack-like dumps): the banner keeps the start.
    this.text.textContent = message.length > BANNER_MAX ? message.slice(0, BANNER_MAX) + "…" : message;
    this.onAction = action?.run ?? null;
    if (action) {
      this.action.textContent = action.label;
      this.text.after(this.action);
    } else this.action.remove();
    this.root.hidden = false;
  }
}

/** Whether a "정밀도를 낮춰 다시 시도" retry would really tessellate more coarsely. */
export function canRetryCoarser(e: unknown): boolean {
  return e instanceof RetryableCadError && e.byteLength !== undefined && canCoarsen(e.byteLength, e.coarser);
}

/** A file from the moment it is queued until it is loaded, failed or removed. */
interface Entry {
  id: string;
  path: string;
  name: string;
  controller: AbortController;
}

/**
 * App-level hooks for the 파일 menu. `onCheckUpdate` is wired by the auto-update task; while it is
 * null, "업데이트 확인" stays disabled.
 */
export const menuHooks: { onCheckUpdate: (() => void) | null } = {
  onCheckUpdate: () => window.dispatchEvent(new Event("va:check-update")),
};

/** Ctrl+Shift+E (KeyboardEvent.code, so a Korean IME layout still works). */
export function isExportKey(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): boolean {
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyE";
}

export class ThreeViewer {
  readonly model: SceneModel = { files: [] };
  readonly objects = new Map<string, BuiltFile>();
  private nextId = 1;
  private readonly progress = new Progress();
  private readonly banner = new Banner();
  private readonly panel: ScenePanel;
  /** Plain-text status line (bottom left): last load, dimensions, cursor coordinates. */
  private readonly status = el("div", "va3d-status");
  /** Triangle count and load time of the last file. */
  private readonly loadStatus = el("span", "va3d-load");
  /** Display mode, sections, selection, dimensions and cursor readout. */
  readonly tools: ViewTools;
  /** Queued or loading files (not yet settled), by file id. */
  private readonly entries = new Map<string, Entry>();
  /** Files load one at a time (one parse worker, one upload), in the order they were added. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Display frame and unit: per window session only (not persisted). */
  private display: FramePreset = "zup-rh";
  private displayUnit: Unit = "mm";

  /** Top-left "파일 · 보기". */
  readonly menubar: Menubar;
  private exporting = false;
  private clouds: CloudController | null = null;
  private cloudLoading: Promise<CloudController> | null = null;

  constructor(readonly stage: Stage, root: HTMLElement) {
    const toolbar = buildToolbar((action) => this.run(action));
    toolbar.append(navigationSelect(stage.controls));
    toolbar.append(this.displaySelects());
    this.panel = new ScenePanel({
      toggle: (id, v) => this.setVisible(id, v),
      remove: (id) => this.remove(id),
      frame: (id, f) => this.setFileFrame(id, f),
      select: (id) => this.tools.select(id),
    });
    this.tools = new ViewTools(stage, {
      files: () =>
        this.model.files.flatMap((f) => {
          const b = this.objects.get(f.id);
          return b ? [{ id: f.id, group: b.group, nodes: b.nodes, triangles: b.triangles, sourceUnit: f.sourceUnit }] : [];
        }),
      nodeName: (id) => findNode(this.model, id)?.name,
      displayUnit: () => this.displayUnit,
      displayFrame: () => this.display,
      jobRunner: workerRunner(),
      edgeProgress: (done, total) => this.edgeProgress(done, total),
      selected: (id) => { this.panel.setSelected(id); this.clouds?.select(id); },
      notice: (message) => this.banner.show(message),
    });
    this.status.setAttribute("role", "status");
    this.status.append(this.loadStatus, this.tools.dims, this.tools.cursor);
    const bottom = el("div", "va3d-bottom");
    bottom.append(this.status);
    const open = (append: boolean) => window.dispatchEvent(new CustomEvent<OpenEventDetail>(OPEN_EVENT, { detail: { append } }));
    this.menubar = new Menubar([
      {
        label: "파일",
        accessKey: "f",
        items: [
          { label: "열기…", shortcut: "Ctrl+O", run: () => open(false) },
          { label: "장면에 추가…", run: () => open(true) },
          { label: "HTML로 내보내기…", shortcut: "Ctrl+Shift+E", run: () => void this.exportHtml() },
          { separator: true },
          {
            label: "업데이트 확인",
            run: () => menuHooks.onCheckUpdate?.(),
            disabled: () => menuHooks.onCheckUpdate === null,
            title: "다음 작업에서 연결",
          },
        ],
      },
      {
        label: "보기",
        accessKey: "v",
        items: viewMenuItems({
          run: (action) => this.run(action),
          panelShown: () => !this.panel.collapsed,
          setPanelShown: (shown) => this.panel.setCollapsed(!shown),
          controls: this.tools.controls,
        }),
      },
    ], { focusAfter: () => focusCanvas(stage.canvas) });
    root.append(this.menubar.root, this.panel.root, toolbar, this.progress.root, this.banner.root, bottom);
    // Window-level for the viewer's lifetime: a window shows one 3D viewer and never unmounts it
    // (no dispose path); the menubar's document listener is likewise kept (Menubar.dispose exists).
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (!this.menubar.close()) this.tools.escape();
        return;
      }
      if (this.menubar.handleKey(e)) return;
      if (isExportKey(e)) {
        e.preventDefault();
        if (!e.repeat) void this.exportHtml();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      this.run(action);
    });
  }

  /** Toolbar "좌표계" + unit dropdowns (display frame). */
  private displaySelects(): HTMLElement {
    const box = el("span", "va3d-display");
    const make = (cls: string, title: string, options: [string, string][], value: string) => {
      const sel = el("select", cls);
      sel.title = title;
      sel.setAttribute("aria-label", title);
      for (const [v, text] of options) {
        const o = el("option");
        o.value = v;
        o.textContent = text;
        sel.append(o);
      }
      sel.value = value;
      return sel;
    };
    // The closed select shows the short name (keeps the toolbar narrow); the full Korean
    // description is each option's title and the select's tooltip.
    const frame = make("va3d-display-frame", "좌표계 (화면 기준)", FRAME_PRESETS.map((p) => [p, FRAME_SHORT_LABELS[p]]), this.display);
    for (const o of frame.options) o.title = FRAME_LABELS[o.value as FramePreset];
    const unit = make("va3d-display-unit", "단위 (화면 기준)", UNITS.map((u) => [u, UNIT_LABELS[u]]), this.displayUnit);
    const frameTip = () => (frame.title = `좌표계 (화면 기준): ${FRAME_LABELS[frame.value as FramePreset]}`);
    frameTip();
    const apply = (e: Event) => {
      frameTip();
      this.setDisplay(frame.value as FramePreset, unit.value as Unit);
      frame.value = this.display; unit.value = this.displayUnit; frameTip();
      // Hand the keyboard back to the stage so F and 1-7 work right away.
      (e.target as HTMLSelectElement).blur();
    };
    frame.addEventListener("change", apply);
    unit.addEventListener("change", apply);
    box.append(frame, unit);
    return box;
  }

  /**
   * Display frame and unit are independent choices: picking ROS (whose convention is metres)
   * does not switch the unit to m, so changing the frame never silently rescales unit-tagged files.
   */
  setDisplay(display: FramePreset, unit: Unit): void {
    if (this.exporting || this.clouds?.isBusy() || this.clouds?.hasRegistrationPreview()) { this.banner.show("진행 중인 작업이 끝난 뒤 좌표계를 바꾸세요."); return; }
    this.display = display;
    this.displayUnit = unit;
    this.stage.setDisplay(display, unit);
    void this.clouds?.framesChanged();
  }

  /** Set a file's source frame and unit (STEP/IGES keep their fixed mm), then fit all. */
  setFileFrame(fileId: string, frame: ObjectFrame): void {
    if (this.exporting || this.clouds?.isBusy() || this.clouds?.hasRegistrationPreview()) { this.banner.show("진행 중인 작업이 끝난 뒤 좌표계를 바꾸세요."); const file = this.model.files.find((f) => f.id === fileId); if (file) this.panel.addFile(file); return; }
    const file = this.model.files.find((f) => f.id === fileId);
    const built = this.objects.get(fileId);
    if (!file || !built) return;
    file.sourceFrame = frame.frame;
    file.sourceUnit = fixedSourceUnit(file.format) ?? frame.unit;
    this.stage.setObjectFrame(built.group, { frame: file.sourceFrame, unit: file.sourceUnit });
    void this.clouds?.framesChanged(fileId);
  }

  run(action: KeyAction): void {
    if (action.type === "fit") this.stage.fitAll();
    else this.stage.setView(action.view);
  }

  /**
   * 파일 > HTML로 내보내기: the visible scene as one offline HTML file. Not while files load (their
   * objects are not all there yet). The exporter (glTF, meshopt, runtime) is a lazy chunk.
   */
  async exportHtml(): Promise<void> {
    if (this.exporting) return;
    if (this.clouds?.isBusy()) { this.banner.show("포인트클라우드 작업이 끝난 뒤 내보내세요."); return; }
    if (this.entries.size > 0) {
      this.banner.show("파일을 불러오는 중에는 내보낼 수 없습니다. 불러오기가 끝난 뒤 다시 시도하세요.");
      return;
    }
    const files = this.model.files.flatMap((file) => {
      const built = this.objects.get(file.id);
      return built ? [{ file, built }] : [];
    });
    if (!files.some(({ file }) => file.root.visible)) {
      this.banner.show("내보낼 표시 중인 모델이 없습니다.");
      return;
    }
    if (this.clouds && !this.clouds.lockExport()) { this.banner.show("포인트클라우드 화면을 복구한 뒤 내보내세요."); return; }
    this.exporting = true;
    try {
      if (this.clouds?.entries.size) {
        if (!await platform.confirm("HTML에는 현재 표시 중인 점·색상·크기를 담습니다. 사용자 정의 점 속성과 편집·PCD/PLY 저장 기능은 포함되지 않는 보기 전용 파일입니다. 계속할까요?")) return;
      }
      const { exportHtml } = await import("./export/export-html");
      await exportHtml({
        files,
        stage: this.stage,
        display: this.display,
        unit: this.displayUnit,
        mode: this.tools.displayMode,
        sections: this.tools.sectionState(),
        panelCollapsed: this.panel.collapsed,
        progress: (note) => {
          if (note === null) this.progress.hide();
          else this.progress.show("HTML로 내보내기", "export", 0, 0, note);
        },
      });
    } catch (e) {
      this.banner.show(`HTML로 내보내지 못했습니다. (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      this.exporting = false;
      this.clouds?.unlockExport();
    }
  }

  /** Take the 3D files of `paths` (appended to the scene); return the rest. `newWindow`: take nothing. */
  accept(paths: string[], opts: { newWindow: boolean }): string[] {
    if (opts.newWindow) return [...paths];
    for (const p of paths) if (isThreeD(p)) void this.load(p);
    return paths.filter((p) => !isThreeD(p));
  }

  /**
   * Queue one file for loading (shown in the panel right away); failures go to the banner.
   * Resolves with the file id once it is on screen, or null (failed, removed or aborted).
   * `coarser`: STEP/IGES "정밀도를 낮춰 다시 시도" retries so far.
   */
  load(path: string, coarser = 0): Promise<string | null> {
    if (this.exporting) { this.banner.show("HTML 내보내기가 끝난 뒤 파일을 추가하세요."); return Promise.resolve(null); }
    const entry: Entry = { id: `f${this.nextId++}`, path, name: baseName(path), controller: new AbortController() };
    this.entries.set(entry.id, entry);
    this.panel.addLoading(entry.id, entry.name);
    this.updateTitle();
    const run = this.queue.then(() => this.loadEntry(entry, coarser));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Remove a file: abort it if still queued or loading, dispose its objects, drop it from the panel. */
  remove(fileId: string): void {
    if (this.exporting) { this.banner.show("HTML 내보내기가 끝난 뒤 파일을 제거하세요."); return; }
    if (this.clouds?.entries.has(fileId)) {
      void this.clouds.canRemove(fileId).then((ok) => { if (ok && !this.exporting) { this.entries.get(fileId)?.controller.abort(); this.discard(fileId); } });
      return;
    }
    this.entries.get(fileId)?.controller.abort();
    this.discard(fileId);
  }

  /**
   * Abort every queued or loading file (files already on screen stay). Each aborted load cleans
   * up after itself: a file aborted mid-upload is disposed and removed like a × removal. For
   * teardown (e.g. a future window/viewer dispose) and tests.
   */
  abortAll(): void {
    for (const e of this.entries.values()) e.controller.abort();
  }

  setVisible(nodeId: string, visible: boolean): void {
    if (this.exporting) { this.banner.show("HTML 내보내기가 끝난 뒤 표시를 바꾸세요."); const file = this.model.files.find((f) => f.id === nodeId.split("/")[0]); if (file) this.panel.addFile(file); return; }
    if (!setVisible(this.model, nodeId, visible)) return;
    const fileId = nodeId.split("/")[0];
    const o = this.objects.get(fileId)?.nodes.get(nodeId);
    if (o) this.stage.setObjectVisible(o, visible);
  }

  /** Edge lines being built in the worker: shown in the progress box while no file loads. */
  private edgeProgress(done: number, total: number): void {
    if (this.entries.size > 0) return;
    if (done < total) this.progress.show("엣지 표시", "edges", done, total);
    else this.progress.hide();
  }

  private discard(fileId: string): void {
    this.clouds?.remove(fileId);
    const built = this.objects.get(fileId);
    // Model first, then the stage: removing from the stage refreshes the tools (dimensions,
    // triangle totals, edge limit), which must no longer see this file.
    if (built) {
      this.tools.fileRemoved(fileId, built.group);
      this.objects.delete(fileId);
    }
    removeFile(this.model, fileId);
    this.panel.removeFile(fileId);
    if (this.model.files.length === 0) this.loadStatus.textContent = "";
    if (built) {
      this.stage.remove(built.group);
      disposeObject(built.group);
    }
    this.updateTitle();
  }

  private updateTitle(): void {
    void platform.setWindowTitle(windowTitle(this.panel.names())).catch(() => {});
  }

  private async loadEntry(entry: Entry, coarser: number): Promise<string | null> {
    const { id, path, name } = entry;
    const signal = entry.controller.signal;
    if (signal.aborted) {
      this.settle(entry);
      return null;
    }
    const format = formatOf(path);
    const started = performance.now();
    let workerUsed = true;
    const onProgress = (phase: Phase, loaded: number, total: number) => {
      if (!signal.aborted) this.progress.show(name, phase, loaded, total, workerUsed ? undefined : "워커 미사용");
    };
    try {
      let root: TreeNode;
      let built: BuiltFile;
      let cloud: BuiltFile | null = null;
      if (format === "pcd" || format === "ply" || format === "las" || format === "laz") {
        onProgress("read", 0, 0);
        cloud = await (await this.cloudController()).open(id, path, signal);
      }
      if (cloud) {
        root = { id, name, kind: "file", visible: true, children: [], meshIds: [0] };
        built = cloud;
      } else if (format === "stl" || format === "obj" || format === "ply" || format === "step" || format === "iges") {
        onProgress("read", 0, 0);
        const parsed = await loadMeshFile(path, format, onProgress, signal, () => (workerUsed = false), coarser);
        root = buildTree(parsed.tree, name, id, parsed.meshes.map((m) => m.name));
        built = buildParsedFile(parsed, root);
      } else if (format === "gltf" || format === "glb") {
        onProgress("read", 0, 0);
        const scene = await loadGltfFile(path, onProgress, signal);
        ({ root, built } = adoptGltfScene(scene, name, id));
      } else {
        this.banner.show(`${name}: 지원하지 않는 형식입니다.`);
        return null;
      }
      if (signal.aborted) {
        disposeObject(built.group);
        this.clouds?.remove(id);
        return null;
      }
      const reserved = [...this.objects].reduce((n, [key, value]) => n + (this.clouds?.entries.get(key)?.meta.originalCount ?? pointCount(value.group)), 0);
      const incoming = this.clouds?.entries.get(id)?.meta.originalCount ?? pointCount(built.group);
      if (reserved + incoming > 10_000_000) { disposeObject(built.group); throw new Error("장면의 원본 점 합계가 1천만 점 한도를 초과합니다. 다른 파일을 제거하세요."); }
      const file: SceneFile = { id, path, name, format: format!, sourceFrame: "as-is", sourceUnit: fixedSourceUnit(format!) ?? "as-is", root };
      this.model.files.push(file);
      this.objects.set(id, built);
      this.panel.addFile(file);
      // Hidden until uploaded batch by batch; fit first so every batch lands in view.
      this.stage.add(built.group, built.renderables, { frame: file.sourceFrame, unit: file.sourceUnit });
      if (this.model.files.length === 1) this.stage.fitAll("iso");
      else this.stage.fitAll();
      await this.stage.reveal(built.renderables, renderableSizes(built.renderables), (k, n) => onProgress("upload", k, n), signal);
      if (signal.aborted) {
        // Removed (or aborted) mid-upload: nothing of it may stay on screen or in memory.
        this.discard(id);
        return null;
      }
      const points = this.clouds?.entries.get(id)?.meta;
      this.loadStatus.textContent = points ? `점 ${(points.count - points.invalid).toLocaleString()} · ${((performance.now() - started) / 1000).toFixed(1)}초` : formatStatus(built.triangles, performance.now() - started, workerUsed);
      // Hover picking: BVHs built in the worker while the user looks at the model.
      this.tools.prebuild(built.group);
      return id;
    } catch (e) {
      this.discard(id);
      if (isAbort(e) || signal.aborted) return null;
      this.banner.show(
        describeLoadError(name, e),
        canRetryCoarser(e) ? { label: "정밀도를 낮춰 다시 시도", run: () => void this.load(path, coarser + 1) } : undefined,
      );
      return null;
    } finally {
      this.settle(entry);
    }
  }

  /** The entry is done: forget it; a file that never made it into the scene leaves the panel. */
  private settle(entry: Entry): void {
    this.entries.delete(entry.id);
    this.progress.hide();
    if (!this.objects.has(entry.id)) {
      this.panel.removeFile(entry.id);
      this.updateTitle();
    }
  }

  private cloudController(): Promise<CloudController> {
    return this.cloudLoading ??= import("./cloud/controller").then(({ CloudController }) => {
      this.clouds = new CloudController({
        stage: this.stage, tools: this.tools,
        file: (id) => this.model.files.find((f) => f.id === id), built: (id) => this.objects.get(id),
        notice: (text) => this.banner.show(text), unit: () => UNIT_LABELS[this.displayUnit],
        replace: async (id, built) => {
          const file = this.model.files.find((f) => f.id === id), old = this.objects.get(id);
          if (!file || !old) { disposeObject(built.group); return; }
          built.group.visible = file.root.visible;
          this.objects.set(id, built);
          this.tools.fileRemoved(id, old.group);
          this.stage.remove(old.group); disposeObject(old.group);
          this.stage.add(built.group, built.renderables, { frame: file.sourceFrame, unit: file.sourceUnit });
          await this.stage.reveal(built.renderables, renderableSizes(built.renderables));
          this.tools.select(id);
        },
      }, this.panel.root);
      return this.clouds;
    });
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

/** The window's 3D viewer once mounted (one per window). */
let current: ThreeViewer | null = null;

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
    current = v;
    // Resolve as soon as the viewer can take files: the first load (minutes for a big STEP) runs
    // in the queue, so drops and Ctrl+O meanwhile are appended or opened at once. Failures go to
    // the banner.
    void v.load(path);
  },
  accept(paths: string[], opts: { newWindow: boolean }): string[] {
    return current ? current.accept(paths, opts) : [...paths];
  },
};

export default viewer;
