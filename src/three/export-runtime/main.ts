// Viewer runtime of an exported HTML file (built by vite.runtime.config.ts into one IIFE,
// build/runtime/va-runtime.js, inlined into every export). Reads the embedded GLB and state JSON,
// then shows the scene with the app's shared core: stage, scene panel (no remove, no frame
// presets), 보기 menu (display modes, sections, standard views), dimensions and cursor readout.
// No Tauri, no network: everything it needs is in the page.
import threeCss from "../core/three.css?inline";
import { BufferAttribute, type BufferGeometry, type Mesh, type Object3D, type Points, type PointsMaterial } from "three";
import { renderableSizes } from "../core/build-objects";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { Stage, WebGLUnavailableError } from "../core/stage";
import { ScenePanel } from "../core/panel";
import { ViewTools } from "../core/view-tools";
import { workerRunner } from "../geometry-worker";
import { Menubar } from "../core/menubar";
import { buildToolbar, focusCanvas, navigationSelect, viewMenuItems } from "../core/view-menu";
import { keyAction, type KeyAction } from "../core/keys";
import { FRAME_LABELS, FRAME_SHORT_LABELS, UNIT_LABELS } from "../core/frames";
import { meshTriangles } from "../core/info";
import { findNode, setVisible, type SceneFile, type SceneModel, type TreeNode } from "../core/scene-model";
import { fromBase64 } from "../export/codec";
import { parseState, type ExportNode, type ExportState } from "../export/state";

/** Theme variables of the app (styles.css); the page follows the OS light/dark setting. */
const BASE_CSS = `
:root { --bg: #ffffff; --fg: #1f2328; --muted: #6e7781; --border: #d0d7de; color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; --border: #30363d; color-scheme: dark; }
}
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--fg); font-family: system-ui, "Segoe UI", "Malgun Gothic", sans-serif; }
.va-notice { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: var(--muted); }
.va3d-frame-label { color: var(--muted); font-size: 0.75rem; padding: 0 6px; margin-left: 4px; border-left: 1px solid var(--border); align-self: center; white-space: nowrap; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function notice(host: HTMLElement, title: string, detail?: string): void {
  const box = el("div", "va-notice");
  const h = el("p");
  h.textContent = title;
  box.append(h);
  if (detail) {
    const p = el("p");
    p.textContent = detail;
    box.append(p);
  }
  host.replaceChildren(box);
}

function scriptText(id: string): string {
  const s = document.getElementById(id);
  if (!s) throw new Error(`#${id} is missing`);
  return s.textContent ?? "";
}

function toTree(n: ExportNode): TreeNode {
  return { id: n.id, name: n.name, kind: n.kind, visible: n.visible, children: n.children.map(toTree), meshIds: [] };
}

/**
 * Quantized (KHR_mesh_quantization) or interleaved attributes -> plain Float32 ones, so edges,
 * BVHs and bounds work exactly as in the app.
 */
async function dequantize(root: Object3D): Promise<void> {
  const geometries = new Set<BufferGeometry>();
  root.traverse((o) => { const g = (o as Mesh).geometry; if (g) geometries.add(g); });
  for (const g of geometries) {
    for (const name of ["position", "normal"]) {
      const a = g.getAttribute(name);
      if (!a || (!("isInterleavedBufferAttribute" in a && a.isInterleavedBufferAttribute) && a.array instanceof Float32Array && !a.normalized)) continue;
      const out = new Float32Array(a.count * a.itemSize);
      for (let start = 0; start < a.count; start += 65_536) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const end = Math.min(start + 65_536, a.count);
        for (let i = start; i < end; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
      }
      g.setAttribute(name, new BufferAttribute(out, a.itemSize));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

class ExportedViewer {
  private readonly model: SceneModel = { files: [] };
  private readonly files: { id: string; group: Object3D; nodes: Map<string, Object3D>; triangles: number; sourceUnit: SceneFile["sourceUnit"] }[] = [];
  private readonly panel: ScenePanel;
  private readonly tools: ViewTools;
  private readonly menubar: Menubar;

  constructor(
    private readonly stage: Stage,
    root: HTMLElement,
    private readonly state: ExportState,
  ) {
    const toolbar = buildToolbar((a) => this.run(a));
    stage.controls.setMode(state.navigation ?? "arcball");
    toolbar.append(navigationSelect(stage.controls));
    const frame = el("span", "va3d-frame-label");
    frame.textContent = `${FRAME_SHORT_LABELS[state.display]} · ${UNIT_LABELS[state.unit]}`;
    frame.title = `좌표계 (화면 기준): ${FRAME_LABELS[state.display]}, 단위 ${UNIT_LABELS[state.unit]}`;
    toolbar.append(frame);
    this.panel = new ScenePanel({
      toggle: (id, v) => this.setVisible(id, v),
      select: (id) => this.tools.select(id),
    });
    this.tools = new ViewTools(stage, {
      jobRunner: workerRunner(),
      files: () => this.files,
      nodeName: (id) => findNode(this.model, id)?.name,
      displayUnit: () => state.unit,
      displayFrame: () => state.display,
      selected: (id) => this.panel.setSelected(id),
      notice: (message) => {
        const warning = root.querySelector(".va-runtime-warning") ?? el("div", "va3d-banner va-runtime-warning");
        warning.setAttribute("role", "status");
        warning.textContent = message;
        root.append(warning);
      },
    });
    this.menubar = new Menubar([
      {
        label: "보기",
        accessKey: "v",
        items: viewMenuItems({
          run: (a) => this.run(a),
          panelShown: () => !this.panel.collapsed,
          setPanelShown: (shown) => this.panel.setCollapsed(!shown),
          controls: this.tools.controls,
        }),
      },
    ], { focusAfter: () => focusCanvas(stage.canvas) });
    const status = el("div", "va3d-status");
    status.setAttribute("role", "status");
    status.append(this.tools.dims, this.tools.cursor);
    const bottom = el("div", "va3d-bottom");
    bottom.append(status);
    root.append(this.menubar.root, this.panel.root, toolbar, bottom);
    // Lives as long as the exported page: no dispose path.
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (!this.menubar.close()) this.tools.escape();
        return;
      }
      if (this.menubar.handleKey(e)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      this.run(action);
    });
  }

  private run(action: KeyAction): void {
    if (action.type === "fit") this.stage.fitAll();
    else this.stage.setView(action.view);
  }

  private setVisible(nodeId: string, visible: boolean): void {
    if (!setVisible(this.model, nodeId, visible)) return;
    const fileId = nodeId.split("/")[0];
    const o = this.files.find((f) => f.id === fileId)?.nodes.get(nodeId);
    if (o) this.stage.setObjectVisible(o, visible);
  }

  /** Put the loaded glTF scene on stage, file by file, and restore the exported view. */
  async show(scene: Object3D): Promise<void> {
    const pending: Object3D[] = [];
    const sizes: number[] = [];
    const byId = new Map<string, Object3D>();
    scene.traverse((o) => {
      if ((o as Points).isPoints && typeof o.userData.vaPointSize === "number") {
        const material = (o as Points).material as PointsMaterial;
        material.size = Math.max(1, Math.min(10, o.userData.vaPointSize));
        material.sizeAttenuation = false;
      }
      const id = o.userData.vaId;
      if (typeof id === "string") byId.set(id, o);
    });
    for (const f of this.state.files) {
      const group = byId.get(f.id);
      if (!group) continue;
      const root = toTree(f.tree);
      const nodes = new Map<string, Object3D>();
      const link = (n: TreeNode) => {
        const o = byId.get(n.id);
        if (o) nodes.set(n.id, o);
        n.children.forEach(link);
      };
      link(root);
      const file: SceneFile = { id: f.id, path: f.name, name: f.name, format: f.format, sourceFrame: "as-is", sourceUnit: f.sourceUnit, root };
      this.model.files.push(file);
      this.files.push({ id: f.id, group, nodes, triangles: meshTriangles(group), sourceUnit: f.sourceUnit });
      this.panel.addFile(file);
      // The file node carries the baked frame matrix; "as-is" keeps it as the group's own transform.
      const drawables: Object3D[] = [];
      group.traverse((o) => { if ((o as Mesh).geometry && o.visible) drawables.push(o); });
      pending.push(...drawables);
      sizes.push(...renderableSizes(drawables));
      this.stage.add(group, drawables);
    }
    this.tools.restoreSections(this.state.sections);
    if (this.state.panelCollapsed !== undefined) this.panel.setCollapsed(this.state.panelCollapsed);
    const { camera, controls } = this.stage;
    camera.position.fromArray(this.state.camera.position);
    controls.target.fromArray(this.state.camera.target);
    if (this.state.camera.quaternion) camera.quaternion.fromArray(this.state.camera.quaternion);
    else camera.lookAt(controls.target);
    controls.update();
    await this.stage.reveal(pending, sizes);
    this.tools.setMode(this.state.mode);
    this.stage.requestRender();
  }
}

async function main(): Promise<void> {
  const style = document.createElement("style");
  style.textContent = BASE_CSS + threeCss;
  document.head.append(style);
  const host = document.getElementById("va-app") ?? document.body;
  let state: ExportState;
  let glb: Uint8Array;
  try {
    state = parseState(JSON.parse(scriptText("va-state")));
    glb = fromBase64(scriptText("va-glb"));
  } catch (e) {
    notice(host, "내보낸 장면을 읽을 수 없습니다", e instanceof Error ? e.message : String(e));
    return;
  }
  document.title = state.title;
  const root = el("div", "va3d");
  const canvasHost = el("div", "va3d-canvas");
  root.append(canvasHost);
  host.replaceChildren(root);
  let stage: Stage;
  try {
    stage = new Stage(canvasHost);
  } catch (e) {
    if (!(e instanceof WebGLUnavailableError)) throw e;
    notice(host, "3D 장면을 표시할 수 없습니다: WebGL2를 사용할 수 없습니다", "그래픽 드라이버를 업데이트하거나 브라우저의 하드웨어 가속을 켜 주세요.");
    return;
  }
  stage.setDisplay(state.display, state.unit);
  const viewer = new ExportedViewer(stage, root, state);
  try {
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    const gltf = await loader.parseAsync(buffer, "");
    await dequantize(gltf.scene);
    await viewer.show(gltf.scene);
  } catch (e) {
    notice(host, "내보낸 장면을 읽을 수 없습니다", e instanceof Error ? e.message : String(e));
  }
}

void main();
