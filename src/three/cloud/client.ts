import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Box3, BufferAttribute, BufferGeometry, Group, Points, PointsMaterial, Vector3 } from "three";
import { disposeObject, type BuiltFile } from "../core/build-objects";
import { CLOUD_CHUNK, decodeChunk, type Action, type CloudDisplay, type CloudMeta } from "./types";

export class CloudClient {
  job: string | null = null;
  private pendingCancel = false;
  async request(action: Action, meta?: CloudMeta, progress?: (text: string) => void): Promise<CloudMeta | null> {
    if (this.job) throw new Error("작업이 진행 중입니다");
    const job = crypto.randomUUID(); this.job = job; this.pendingCancel = false;
    let unlisten = () => {};
    try {
      unlisten = await listen<{ jobId: string; loaded: number; total: number }>("va-cloud-progress", ({ payload }) => {
        if (payload.jobId === job) progress?.(payload.total ? `처리 중 ${Math.floor(payload.loaded / payload.total * 100)}%` : "처리 중…");
        if (this.pendingCancel) void invoke("cloud_cancel", { jobId: job }).catch(() => {});
      });
      const result = await invoke<CloudMeta | null>("cloud_request", { jobId: job, session: meta?.id ?? null, revision: meta?.revision ?? null, action });
      if (this.pendingCancel && action.type === "open") {
        if (result) await this.close(result.id);
        throw new DOMException("작업을 취소했습니다", "AbortError");
      }
      return result;
    } finally { unlisten(); this.job = null; }
  }
  cancel(): void { this.pendingCancel = true; if (this.job) void invoke("cloud_cancel", { jobId: this.job }).catch(() => {}); }
  async register(source: CloudMeta, sourceMatrix: number[], target: CloudMeta, targetMatrix: number[], maxDistance: number, sampleLimit: number, progress?: (text: string) => void): Promise<{ matrix: number[]; pairs: number; sampledSource: number; sampledTarget: number; fitness: number; rmse: number; iterations: number; converged: boolean }> {
    if (this.job) throw new Error("작업이 진행 중입니다");
    const job = crypto.randomUUID(); this.job = job; this.pendingCancel = false;
    let unlisten = () => {};
    try {
      unlisten = await listen<{ jobId: string; loaded: number; total: number }>("va-cloud-progress", ({ payload }) => {
        if (payload.jobId === job) progress?.(payload.total ? `정합 중 ${Math.floor(payload.loaded / payload.total * 100)}%` : "정합 중…");
        if (this.pendingCancel) void invoke("cloud_cancel", { jobId: job }).catch(() => {});
      });
      const result = await invoke<{ matrix: number[]; pairs: number; sampledSource: number; sampledTarget: number; fitness: number; rmse: number; iterations: number; converged: boolean }>("cloud_register", { jobId: job, source: source.id, sourceRevision: source.revision, sourceMatrix, target: target.id, targetRevision: target.revision, targetMatrix, maxDistance, sampleLimit, maxIterations: 50 });
      if (this.pendingCancel) throw new DOMException("작업을 취소했습니다", "AbortError");
      return result;
    } finally { unlisten(); this.job = null; }
  }
  close(session: string): Promise<void> { return invoke("cloud_close", { session }); }
  point(session: string, point: number): Promise<{ id: number; position: number[]; fields: Record<string, { values: string[]; count: number }> }> { return invoke("cloud_point", { session, point }); }
}

/** Build offscreen, keeping the last complete scene on failures. Source coordinates stay in Rust. */
export async function buildCloud(meta: CloudMeta, fileId: string, display: CloudDisplay, size: number, signal?: AbortSignal): Promise<BuiltFile> {
  const group = new Group(); group.position.fromArray(meta.origin);
  const built: BuiltFile = { group, nodes: new Map([[fileId, group]]), triangles: 0, renderables: [] };
  const material = new PointsMaterial({ vertexColors: true, size, sizeAttenuation: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute float vaSelected; varying float vSelected;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSelected = vaSelected;");
    shader.fragmentShader = "varying float vSelected;\n" + shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\nif (vSelected > 0.5) diffuseColor.rgb = vec3(1.0, 0.65, 0.05);");
  };
  group.userData.vaCloud = true;
  try {
    for (let start = 0; start < meta.count; start += CLOUD_CHUNK) {
      signal?.throwIfAborted();
      const buffer = await invoke<ArrayBuffer>("cloud_chunk", { session: meta.id, revision: meta.revision, start, display });
      signal?.throwIfAborted();
      const data = decodeChunk(buffer);
      if (data.positions.length) {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
        geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
        geometry.setAttribute("vaPick", new BufferAttribute(data.pick, 3, true));
        geometry.setAttribute("vaSelected", new BufferAttribute(data.selected, 1));
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const points = new Points(geometry, material); points.userData.vaPointSize = size;
        group.add(points); built.renderables.push(points);
      }
      // Native IPC completion yields; force a frame between uploads/array decoding as well.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    signal?.throwIfAborted();
    if (!built.renderables.length) { material.dispose(); group.userData.vaEmptyBounds = new Box3(new Vector3(), new Vector3()); }
    return built;
  } catch (e) { disposeObject(group); material.dispose(); throw e; }
}
