// "보기" tools of the 3D stage: display mode and section planes (a compact popover in the bottom
// bar), click selection with a display-frame bounding box, dimensions and the cursor coordinate
// readout. No Tauri: shared with the exported-HTML runtime.
import { Box3, Box3Helper, Color, Vector2, Vector3, type Camera, type Intersection, type Material, type Matrix4, type Object3D } from "three";
import { AXES, AXIS_NAMES, Clipper, type Axis } from "./clipping";
import { canShowEdges, DISPLAY_MODE_LABELS, DISPLAY_MODES, DisplayModes, type DisplayMode } from "./display-modes";
import { CURSOR_TRIANGLE_LIMIT, decimalsFor, displayBox, formatPoint, formatSize, meshTriangles, Picker } from "./info";
import { UNIT_LABELS, type Unit } from "./frames";

/** What the tools need from the stage. */
export interface ToolStage {
  readonly content: Object3D;
  /** Display-frame overlay group (the selection box goes here). */
  readonly overlay: Object3D;
  readonly camera: Camera;
  readonly displayToWorld: Matrix4;
  readonly canvas: HTMLElement;
  requestRender(): void;
  onChange(fn: () => void): void;
}

export interface ToolFile {
  id: string;
  group: Object3D;
  /** Tree node id -> its Object3D. */
  nodes: Map<string, Object3D>;
  triangles: number;
  sourceUnit: Unit | "as-is";
}

export interface ToolHost {
  files(): ToolFile[];
  nodeName(nodeId: string): string | undefined;
  displayUnit(): Unit;
  /** The selection changed (the panel follows). */
  selected(nodeId: string | null): void;
  /** A one-off notice for the user (e.g. edges turned off). */
  notice(message: string): void;
}

const SLIDER_STEPS = 1000;
/** Pointer travel (px) up to which a press-release still counts as a click, not an orbit. */
const CLICK_SLOP = 4;
const SELECTION_COLOR = 0x3e7bfa;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

export class ViewTools {
  /** Bottom-left bar: the "보기" button and its popover. */
  readonly bar = el("div", "va3d-viewbar");
  /** Status line parts (plain text). */
  readonly dims = el("span", "va3d-dims");
  readonly cursor = el("span", "va3d-cursor");
  readonly clipper = new Clipper();
  readonly modes = new DisplayModes(this.clipper.planes);
  private readonly picker = new Picker();
  private readonly button = el("button", "va3d-view-button");
  private readonly menu = el("div", "va3d-view-menu");
  private readonly edgeNote = el("p", "va3d-view-note");
  private readonly modeInputs = new Map<DisplayMode, HTMLInputElement>();
  private readonly clipRows: { check: HTMLInputElement; slider: HTMLInputElement; value: HTMLElement }[] = [];
  private mode: DisplayMode = "solid";
  private selection: string | null = null;
  private selectionBox: Box3Helper | null = null;
  /** Largest display extent of the scene (number formatting). */
  private extent = 0;
  private hoverAt: { x: number; y: number } | null = null;
  private hoverFrame = 0;
  private press: { x: number; y: number } | null = null;
  private readonly reverse = new WeakMap<Map<string, Object3D>, Map<Object3D, string>>();

  constructor(
    private readonly stage: ToolStage,
    private readonly host: ToolHost,
  ) {
    this.buildMenu();
    // Updated every frame under the pointer: keep it out of the status live region.
    this.cursor.setAttribute("aria-hidden", "true");
    stage.onChange(() => this.refresh());
    const canvas = stage.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.press = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("pointerup", (e) => {
      const p = this.press;
      this.press = null;
      if (e.button === 0 && p && Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP) this.click(e.clientX, e.clientY);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.buttons !== 0) return; // orbiting or panning: keep the last readout
      this.hoverAt = { x: e.clientX, y: e.clientY };
      if (!this.hoverFrame) this.hoverFrame = requestAnimationFrame(() => this.hover());
    });
    canvas.addEventListener("pointerleave", () => {
      this.hoverAt = null;
      this.cursor.textContent = "";
    });
    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !this.bar.contains(e.target as Node)) this.showMenu(false);
    });
  }

  private buildMenu(): void {
    this.button.type = "button";
    this.button.textContent = "보기 ▾";
    this.button.title = "표시 모드와 단면";
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.setAttribute("aria-expanded", "false");
    this.button.addEventListener("click", () => this.showMenu(this.menu.hidden !== false));
    this.menu.hidden = true;
    this.menu.setAttribute("role", "dialog");
    this.menu.setAttribute("aria-label", "보기");
    this.menu.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      this.showMenu(false);
      this.button.focus();
    });

    const modes = el("fieldset", "va3d-view-modes");
    const legend = el("legend");
    legend.textContent = "표시";
    modes.append(legend);
    for (const mode of DISPLAY_MODES) {
      const label = el("label");
      const input = el("input");
      input.type = "radio";
      input.name = "va3d-mode";
      input.value = mode;
      input.checked = mode === this.mode;
      input.addEventListener("change", () => input.checked && this.setMode(mode));
      const text = el("span");
      text.textContent = DISPLAY_MODE_LABELS[mode];
      label.append(input, text);
      modes.append(label);
      this.modeInputs.set(mode, input);
    }
    this.edgeNote.textContent = "삼각형 500만 개 초과: 엣지 표시를 쓸 수 없습니다.";
    this.edgeNote.hidden = true;
    modes.append(this.edgeNote);

    const clip = el("fieldset", "va3d-view-clip");
    const clipLegend = el("legend");
    clipLegend.textContent = "단면 (화면 좌표계)";
    clip.append(clipLegend);
    for (const axis of AXES) {
      const row = el("label", "va3d-clip-row");
      const check = el("input");
      check.type = "checkbox";
      check.setAttribute("aria-label", `${AXIS_NAMES[axis]} 단면`);
      const name = el("span", "va3d-clip-axis");
      name.textContent = AXIS_NAMES[axis];
      const slider = el("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = String(SLIDER_STEPS);
      slider.value = String(SLIDER_STEPS);
      slider.setAttribute("aria-label", `${AXIS_NAMES[axis]} 단면 위치`);
      const value = el("span", "va3d-clip-value");
      check.addEventListener("change", () => this.setClip(axis, { enabled: check.checked }));
      slider.addEventListener("input", () => this.setClip(axis, { enabled: true, t: Number(slider.value) / SLIDER_STEPS }));
      row.append(check, name, slider, value);
      clip.append(row);
      this.clipRows.push({ check, slider, value });
    }
    this.menu.append(modes, clip);
    this.bar.append(this.button, this.menu);
  }

  private showMenu(open: boolean): void {
    this.menu.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  get displayMode(): DisplayMode {
    return this.mode;
  }

  setMode(mode: DisplayMode): void {
    if (mode === "edges" && !canShowEdges(this.totalTriangles())) mode = "solid";
    this.mode = mode;
    const input = this.modeInputs.get(mode);
    if (input) input.checked = true;
    this.modes.apply(this.stage.content, mode);
    this.stage.requestRender();
  }

  private setClip(axis: Axis, change: { enabled?: boolean; t?: number }): void {
    this.clipper.set(axis, change);
    this.paintClip();
    this.stage.requestRender();
  }

  private paintClip(): void {
    const decimals = decimalsFor(this.extent);
    AXES.forEach((axis) => {
      const row = this.clipRows[axis];
      const state = this.clipper.axes[axis];
      row.check.checked = state.enabled;
      row.slider.value = String(Math.round(state.t * SLIDER_STEPS));
      row.value.textContent = state.enabled ? this.clipper.value(axis).toFixed(decimals) : "";
    });
  }

  /** Escape: close the popover if open, else clear the selection. */
  escape(): void {
    if (!this.menu.hidden) return this.showMenu(false);
    this.select(null);
  }

  /** Select a tree node (null: none); the panel follows through `host.selected`. */
  select(nodeId: string | null): void {
    if (nodeId === this.selection) return;
    this.selection = nodeId;
    this.host.selected(nodeId);
    this.paintSelection();
    this.stage.requestRender();
  }

  get selected(): string | null {
    return this.selection;
  }

  /** A file is about to be disposed: drop its edges, BVHs and any selection inside it. */
  fileRemoved(fileId: string, group: Object3D): void {
    this.modes.release(group);
    this.picker.release(group);
    const s = this.selection;
    if (s && (s === fileId || s.startsWith(fileId + "/"))) this.select(null);
  }

  private totalTriangles(): number {
    return this.host.files().reduce((n, f) => n + f.triangles, 0);
  }

  /** After any scene change: modes on new content, section range, dimensions. */
  refresh(): void {
    const total = this.totalTriangles();
    const edgesOk = canShowEdges(total);
    const edgeInput = this.modeInputs.get("edges")!;
    edgeInput.disabled = !edgesOk;
    this.edgeNote.hidden = edgesOk;
    if (this.mode === "edges" && !edgesOk) {
      this.host.notice("삼각형이 500만 개를 넘어 엣지 표시를 껐습니다.");
      this.mode = "solid";
      this.modeInputs.get("solid")!.checked = true;
    }
    this.modes.apply(this.stage.content, this.mode);

    const scene = displayBox(this.stage.content, this.stage.displayToWorld, { visibleOnly: true });
    const size = scene.isEmpty() ? new Vector3() : scene.getSize(new Vector3());
    this.extent = Math.max(size.x, size.y, size.z);
    this.clipper.setRange(scene.isEmpty() ? [0, 0, 0] : scene.min.toArray(), scene.isEmpty() ? [0, 0, 0] : scene.max.toArray());
    this.clipper.setDisplayMatrix(this.stage.displayToWorld);
    this.paintClip();
    if (total > CURSOR_TRIANGLE_LIMIT) this.cursor.textContent = "";
    this.paintSelection();
  }

  private findNode(nodeId: string): Object3D | undefined {
    const fileId = nodeId.split("/")[0];
    return this.host.files().find((f) => f.id === fileId)?.nodes.get(nodeId);
  }

  /** Dimensions text and the selection box. */
  private paintSelection(): void {
    if (this.selectionBox) {
      this.selectionBox.removeFromParent();
      this.selectionBox.geometry.dispose();
      (this.selectionBox.material as Material).dispose();
      this.selectionBox = null;
    }
    const files = this.host.files();
    if (files.length === 0) {
      this.dims.textContent = "";
      return;
    }
    const unit = this.host.displayUnit();
    const decimals = decimalsFor(this.extent);
    const object = this.selection ? this.findNode(this.selection) : undefined;
    if (this.selection && object) {
      const box = displayBox(object, this.stage.displayToWorld);
      const name = this.host.nodeName(this.selection) ?? "";
      const size = box.isEmpty() ? "-" : formatSize(box.getSize(new Vector3()).toArray(), unit, decimals);
      this.dims.textContent = `선택 ${name}: ${size} · 삼각형 ${meshTriangles(object).toLocaleString("en-US")}`;
      if (!box.isEmpty()) this.showBox(box);
      return;
    }
    const scene = displayBox(this.stage.content, this.stage.displayToWorld, { visibleOnly: true });
    const size = scene.isEmpty() ? "-" : formatSize(scene.getSize(new Vector3()).toArray(), unit, decimals);
    this.dims.textContent = `전체 ${size} · 삼각형 ${this.totalTriangles().toLocaleString("en-US")}`;
  }

  private showBox(box: Box3): void {
    const helper = new Box3Helper(new Box3().copy(box), new Color(SELECTION_COLOR));
    const m = helper.material as Material;
    m.depthTest = false;
    m.transparent = true;
    m.opacity = 0.7;
    helper.renderOrder = 2;
    helper.raycast = () => {};
    this.selectionBox = helper;
    this.stage.overlay.add(helper);
  }

  private ndc(x: number, y: number): Vector2 {
    const r = this.stage.canvas.getBoundingClientRect();
    return new Vector2(((x - r.left) / Math.max(1, r.width)) * 2 - 1, -((y - r.top) / Math.max(1, r.height)) * 2 + 1);
  }

  private pickAt(x: number, y: number, bvh: boolean): Intersection | null {
    const clipped = this.clipper.active() ? (p: Vector3) => this.clipper.clipped(p) : undefined;
    return this.picker.pick(this.stage.content, this.stage.camera, this.ndc(x, y), { bvh, clipped });
  }

  /** Click: select the deepest tree node owning the hit mesh, or clear on empty space. */
  click(x: number, y: number): void {
    // Above the hover limit no BVH is built: one plain raycast per click.
    const hit = this.pickAt(x, y, this.totalTriangles() <= CURSOR_TRIANGLE_LIMIT);
    this.select(hit ? this.nodeOf(hit.object) : null);
  }

  private fileOf(o: Object3D): ToolFile | undefined {
    let top: Object3D | null = o;
    while (top && top.parent !== this.stage.content) top = top.parent;
    return top ? this.host.files().find((f) => f.group === top) : undefined;
  }

  private nodeOf(o: Object3D): string | null {
    const file = this.fileOf(o);
    if (!file) return null;
    let map = this.reverse.get(file.nodes);
    if (!map) {
      map = new Map([...file.nodes].map(([id, obj]) => [obj, id]));
      this.reverse.set(file.nodes, map);
    }
    for (let a: Object3D | null = o; a; a = a.parent) {
      const id = map.get(a);
      if (id) return id;
    }
    return null;
  }

  /** Cursor readout for the last pointer position (once per animation frame). */
  private hover(): void {
    this.hoverFrame = 0;
    const at = this.hoverAt;
    if (!at) return;
    if (this.totalTriangles() > CURSOR_TRIANGLE_LIMIT) {
      this.cursor.textContent = "커서 좌표 꺼짐 (삼각형 500만 개 초과)";
      return;
    }
    const hit = this.pickAt(at.x, at.y, true);
    this.cursor.textContent = hit ? this.describe(hit) : "";
  }

  /** "X … Y … Z … mm (원본: X … Y … Z … inch)"; the source part only when it differs. */
  describe(hit: Intersection): string {
    const decimals = decimalsFor(this.extent);
    const display = hit.point.clone().applyMatrix4(this.stage.displayToWorld.clone().invert());
    let text = `${formatPoint(display.toArray(), decimals)} ${UNIT_LABELS[this.host.displayUnit()]}`;
    const file = this.fileOf(hit.object);
    if (file) {
      const source = file.group.worldToLocal(hit.point.clone());
      if (source.distanceTo(display) > 1e-9 * Math.max(1, this.extent)) {
        const scale = file.group.matrix.getMaxScaleOnAxis() || 1;
        const unit = file.sourceUnit === "as-is" ? "" : ` ${UNIT_LABELS[file.sourceUnit]}`;
        text += ` (원본: ${formatPoint(source.toArray(), decimalsFor(this.extent / scale))}${unit})`;
      }
    }
    return text;
  }

  dispose(): void {
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame);
    this.modes.dispose();
  }
}
