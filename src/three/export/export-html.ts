// 파일 > HTML로 내보내기: the visible scene as one offline HTML file (GLB with meshopt, state
// JSON, the va-runtime viewer). Loaded lazily by the viewer; the runtime bundle comes in as text
// (`?raw`), so it only reaches this chunk.
import runtime from "../../../build/runtime/va-runtime.js?raw";
import { platform } from "../../platform";
import type { Stage } from "../core/stage";
import type { BuiltFile } from "../core/build-objects";
import type { SceneFile } from "../core/scene-model";
import type { FramePreset, Unit } from "../core/frames";
import type { DisplayMode } from "../core/display-modes";
import { buildExportScene, exportGlb, exportTree } from "./scene";
import { defaultHtmlPath, renderHtml } from "./template";
import { STATE_VERSION, type ExportSection, type ExportState } from "./state";
import { exceedsSizeWarning, formatMegabytes } from "./size";

export interface ExportInput {
  files: { file: SceneFile; built: BuiltFile }[];
  stage: Stage;
  display: FramePreset;
  unit: Unit;
  mode: DisplayMode;
  sections: ExportSection[];
  panelCollapsed: boolean;
  /** Progress note ("GLB 만드는 중", "압축 중", ...); null: done. */
  progress(note: string | null): void;
}

/** meshopt compression in the export worker; inline when the worker cannot run. */
async function compress(glb: Uint8Array): Promise<Uint8Array> {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./compress.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  if (worker) {
    const w = worker;
    try {
      return await new Promise<Uint8Array>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<{ ok: boolean; glb?: Uint8Array; message?: string }>) =>
          e.data.ok && e.data.glb ? resolve(e.data.glb) : reject(new Error(e.data.message ?? "compression failed"));
        w.onerror = (e) => reject(new Error(e.message || "export worker failed"));
        // Copy, not transfer: the inline fallback below still needs the bytes.
        w.postMessage({ glb });
      });
    } catch (e) {
      console.warn("export worker failed, compressing on the UI thread", e);
    } finally {
      w.terminate();
    }
  }
  const { compressGlb } = await import("./compress");
  return compressGlb(glb);
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Returns the saved path, or null when the user cancelled. */
export async function exportHtml(input: ExportInput): Promise<string | null> {
  const first = input.files[0]?.file;
  if (!first) throw new Error("내보낼 장면이 없습니다.");
  const path = await platform.saveDialog({
    title: "HTML로 내보내기",
    defaultPath: defaultHtmlPath(first.path),
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!path) return null;
  try {
    input.progress("GLB 만드는 중");
    await nextFrame();
    const sources = input.files.map(({ file, built }) => ({ root: file.root, group: built.group, nodes: built.nodes }));
    const exported = buildExportScene(sources);
    let glb: Uint8Array;
    try {
      glb = await exportGlb(exported.scene);
    } finally {
      exported.dispose();
    }
    input.progress("압축 중");
    const packed = await compress(glb);
    const { camera, controls } = input.stage;
    const title = input.files.length > 1 ? `${first.name} 외 ${input.files.length - 1}개` : first.name;
    const state: ExportState = {
      version: STATE_VERSION,
      title,
      display: input.display,
      unit: input.unit,
      mode: input.mode,
      sections: input.sections,
      camera: { position: camera.position.toArray(), target: controls.target.toArray() },
      panelCollapsed: input.panelCollapsed,
      files: input.files
        .filter(({ file }) => file.root.visible)
        .map(({ file }) => ({ id: file.id, name: file.name, format: file.format, sourceUnit: file.sourceUnit, tree: exportTree(file.root) })),
    };
    input.progress("HTML 만드는 중");
    await nextFrame();
    const bytes = new TextEncoder().encode(renderHtml({ title, glb: packed, state, runtime }));
    if (exceedsSizeWarning(bytes.byteLength)) {
      input.progress(null);
      const ok = await platform.confirm(`내보낸 HTML이 ${formatMegabytes(bytes.byteLength)}입니다 (50 MB 초과). 큰 파일은 브라우저에서 열 때 오래 걸릴 수 있습니다. 그래도 저장할까요?`);
      if (!ok) return null;
    }
    input.progress("저장 중");
    await platform.writeFileRaw(path, bytes);
    return path;
  } finally {
    input.progress(null);
  }
}
