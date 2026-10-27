// The 3D stage: renderer, camera, Meshmixer-style orbit controls, camera-attached lighting,
// display-frame grid/axes, render-on-demand, theme and resize tracking.
import {
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  Matrix4,
  MOUSE,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { displayRootMatrix, type FramePreset } from "./frames";
import { fitDistance, standardViewDirection, standardViewUp, type StandardView } from "./views";
import { batchByBudget, clipPlanes, gridSpec, orbitDirection } from "./stage-math";

export class WebGLUnavailableError extends Error {
  constructor() {
    super("WebGL2 is not available");
    this.name = "WebGLUnavailableError";
  }
}

const FIT_MARGIN = 1.1;
/** Triangles uploaded per frame by `reveal` (~36 MB of non-indexed positions). */
const UPLOAD_BUDGET = 1_000_000;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.1, 1000);
  readonly controls: OrbitControls;
  /** Display frame -> three.js world (Y-up). Everything shown lives under it. */
  readonly displayRoot = new Group();
  /** File objects go here (display-frame coordinates). */
  readonly content = new Group();

  private readonly display: FramePreset = "zup-rh";
  private readonly displayMatrix = new Matrix4();
  private readonly helpers = new Group();
  private readonly bounds = new Sphere(new Vector3(), 1);
  private clipRadius = 1;
  private pending = 0;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly host: HTMLElement) {
    if (typeof WebGL2RenderingContext === "undefined") throw new WebGLUnavailableError();
    try {
      this.renderer = new WebGLRenderer({ antialias: true });
    } catch {
      throw new WebGLUnavailableError();
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.append(this.renderer.domElement);

    this.displayMatrix.fromArray(displayRootMatrix(this.display));
    this.displayRoot.matrixAutoUpdate = false;
    this.displayRoot.matrix.copy(this.displayMatrix);
    this.displayRoot.add(this.helpers, this.content);
    this.scene.add(this.displayRoot);

    // Orbit axis = the display frame's up, mapped to world. Must be set before OrbitControls
    // is built (it caches the up-axis rotation).
    const up = this.worldVector(standardViewUp("front", this.display));
    this.camera.up.copy(up);
    this.scene.add(this.camera);

    // Lighting follows the camera: a key light attached to it, plus a hemisphere fill. Three's
    // hemisphere light takes its sky direction from its world position, so it stays in the
    // scene, pointing along the display up axis (attaching it to the camera would aim it from
    // the origin to the camera).
    const hemi = new HemisphereLight(0xffffff, 0x5a5a66, 1.1);
    hemi.position.copy(up);
    this.scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 1.9);
    key.position.set(0, 0.35, 1); // headlight, slightly from above: every face the camera sees gets light
    key.target.position.set(0, 0, 0);
    this.camera.add(key, key.target);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("change", () => this.requestRender());

    this.trackTheme();
    this.trackSize();
    this.rebuildHelpers();
    this.setView("iso");
  }

  /** Display-frame direction -> world direction. */
  private worldVector(v: readonly number[]): Vector3 {
    return new Vector3(v[0], v[1], v[2]).transformDirection(this.displayMatrix);
  }

  requestRender(): void {
    if (this.pending || this.disposed) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.render();
    });
  }

  private render(): void {
    if (this.disposed) return;
    const { near, far } = clipPlanes(
      this.camera.position.distanceTo(this.bounds.center),
      this.clipRadius,
      this.camera.position.distanceTo(this.controls.target),
    );
    if (near !== this.camera.near || far !== this.camera.far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Add a file object. `pending` draw objects stay hidden (but count for bounds and fitting)
   * until `reveal` uploads them, so adding a huge mesh never uploads it in one frame.
   */
  add(object: Object3D, pending: readonly Object3D[] = []): void {
    for (const o of pending) {
      o.visible = false;
      o.userData.vaPending = true;
    }
    this.content.add(object);
    this.updateBounds();
    this.requestRender();
  }

  /**
   * Show pending objects batch by batch (about UPLOAD_BUDGET triangles per frame), rendering after
   * each batch so its buffers go to the GPU in that frame. Shaders are compiled (async where the
   * driver supports it) before the first batch. Resolves when the last batch is on screen.
   */
  async reveal(objects: readonly Object3D[], sizes: readonly number[], onStep?: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    const batches = batchByBudget(sizes, UPLOAD_BUDGET);
    for (let b = 0; b < batches.length; b++) {
      if (this.disposed || signal?.aborted) return;
      for (const i of batches[b]) {
        objects[i].visible = true;
        delete objects[i].userData.vaPending;
      }
      if (b === 0) await this.renderer.compileAsync(this.scene, this.camera);
      if (this.disposed || signal?.aborted) return;
      this.render();
      onStep?.(b + 1, batches.length);
      await nextFrame();
    }
  }

  remove(object: Object3D): void {
    this.content.remove(object);
    this.updateBounds();
    this.requestRender();
  }

  /** Recompute the bounding sphere of visible (or pending) content (world), then resize the grid to match. */
  updateBounds(): void {
    this.scene.updateMatrixWorld(true);
    const box = new Box3();
    const part = new Box3();
    // Visible content plus objects still waiting for upload (hidden only because they are pending).
    const visit = (o: Object3D) => {
      if (!o.visible && !o.userData.vaPending) return;
      const g = (o as Object3D & { geometry?: BufferGeometry }).geometry;
      if (g) {
        if (!g.boundingBox) g.computeBoundingBox();
        box.union(part.copy(g.boundingBox!).applyMatrix4(o.matrixWorld));
      }
      o.children.forEach(visit);
    };
    visit(this.content);
    if (box.isEmpty()) this.bounds.set(new Vector3(), 1);
    else box.getBoundingSphere(this.bounds);
    if (!(this.bounds.radius > 0)) this.bounds.radius = 1e-3;
    this.rebuildHelpers();
  }

  /** Frame all visible content; with `view`, also turn to that standard view. */
  fitAll(view?: StandardView): void {
    let dir: Vector3;
    if (view) {
      const d = this.worldVector(standardViewDirection(view, this.display));
      const viewUp = this.worldVector(standardViewUp(view, this.display));
      const o = orbitDirection(d.toArray(), viewUp.toArray(), this.camera.up.toArray());
      dir = new Vector3(o[0], o[1], o[2]);
    } else {
      dir = this.camera.position.clone().sub(this.controls.target);
      if (dir.lengthSq() === 0) return this.fitAll("iso");
      dir.normalize();
    }
    const distance = fitDistance(this.bounds.radius, this.camera.fov, this.camera.aspect) * FIT_MARGIN;
    this.controls.target.copy(this.bounds.center);
    this.camera.position.copy(this.bounds.center).addScaledVector(dir, distance);
    this.camera.lookAt(this.bounds.center);
    this.controls.update();
    this.requestRender();
  }

  setView(view: StandardView): void {
    this.fitAll(view);
  }

  private themeColors() {
    const css = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { bg: read("--bg", "#ffffff"), muted: read("--muted", "#6e7781"), border: read("--border", "#d0d7de") };
  }

  private trackTheme(): void {
    const apply = () => {
      this.renderer.setClearColor(new Color(this.themeColors().bg));
      this.rebuildHelpers();
      this.requestRender();
    };
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", apply);
    this.cleanups.push(() => {
      observer.disconnect();
      media?.removeEventListener("change", apply);
    });
    apply();
  }

  private trackSize(): void {
    const resize = () => {
      const w = Math.max(1, this.host.clientWidth);
      const h = Math.max(1, this.host.clientHeight);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(this.host);
    this.cleanups.push(() => observer.disconnect());
    resize();
  }

  /**
   * Grid on the display frame's ground plane (through the origin, under the model) and axes at
   * the display origin, both sized from the content bounds and coloured from the theme.
   */
  private rebuildHelpers(): void {
    for (const child of [...this.helpers.children]) {
      this.helpers.remove(child);
      disposeHelper(child);
    }
    const spec = gridSpec(this.bounds.radius);
    const { muted, border } = this.themeColors();
    const grid = new GridHelper(spec.size, spec.divisions, new Color(muted), new Color(border));
    const upD = standardViewUp("front", this.display);
    const up = new Vector3(upD[0], upD[1], upD[2]);
    grid.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), up);
    // Centre under the model (display coordinates), snapped to whole cells, on the up = 0 plane.
    const c = this.bounds.center.clone().applyMatrix4(this.displayMatrix.clone().invert());
    c.addScaledVector(up, -c.dot(up));
    grid.position.set(...(c.toArray().map((x) => Math.round(x / spec.cell) * spec.cell) as [number, number, number]));
    const material = grid.material as Material;
    material.transparent = true;
    material.opacity = 0.8;
    material.depthWrite = false;
    grid.renderOrder = -1;
    const axes = new AxesHelper(spec.size / 4);
    (axes.material as Material).depthTest = false;
    axes.renderOrder = 1;
    this.helpers.add(grid, axes);
    // Clip planes must keep the grid as well as the model.
    const gridReach = grid.position.clone().applyMatrix4(this.displayMatrix).distanceTo(this.bounds.center) + spec.size * 0.75;
    this.clipRadius = Math.max(this.bounds.radius, gridReach);
  }

  dispose(): void {
    this.disposed = true;
    if (this.pending) cancelAnimationFrame(this.pending);
    this.cleanups.forEach((f) => f());
    this.controls.dispose();
    for (const child of this.helpers.children) disposeHelper(child);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function disposeHelper(o: Object3D): void {
  const h = o as Object3D & { geometry?: BufferGeometry; material?: Material };
  h.geometry?.dispose();
  h.material?.dispose();
}
