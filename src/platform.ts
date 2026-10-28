import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { THREE_D_EXTENSIONS } from "./three/formats";

export const platform = {
  async readFile(path: string): Promise<Uint8Array> {
    return new Uint8Array(await invoke<number[]>("read_file", { path }));
  },
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await invoke("write_file", { path, data: Array.from(data) });
  },
  /** Raw-bytes IPC (no JSON number array), for large files. */
  async readFileRaw(path: string): Promise<ArrayBuffer> {
    return invoke<ArrayBuffer>("read_file_raw", { path });
  },
  /** Raw-bytes atomic write; the path travels percent-encoded in the `x-va-path` header. */
  async writeFileRaw(path: string, data: Uint8Array): Promise<void> {
    await invoke("write_file_raw", data, { headers: { "x-va-path": encodeURIComponent(path) } });
  },
  /** Whether Shift is held right now; null where the OS cannot tell (non-Windows). */
  async modifierShift(): Promise<boolean | null> {
    return invoke<boolean | null>("modifier_shift");
  },
  /** Native save dialog; null when cancelled. */
  async saveDialog(opts: SaveDialogOptions): Promise<string | null> {
    return save(opts);
  },
  assetUrl(absPath: string): string {
    return convertFileSrc(absPath);
  },
  async openWindow(path?: string): Promise<void> {
    await invoke("open_window", { path: path ?? null });
  },
  /** Native file-open dialog; [] when cancelled. `only3d`: 3D models only (장면에 추가). */
  async pickFiles(opts: { only3d?: boolean } = {}): Promise<string[]> {
    const models = { name: "3D 모델", extensions: [...THREE_D_EXTENSIONS] };
    const picked = await open({
      multiple: true,
      directory: false,
      filters: opts.only3d
        ? [models]
        : [{ name: "Markdown", extensions: ["md", "markdown"] }, { name: "CSV", extensions: ["csv"] }, models, { name: "모든 파일", extensions: ["*"] }],
    });
    if (picked === null) return [];
    return Array.isArray(picked) ? picked : [picked];
  },
  async openExternal(url: string): Promise<void> {
    await openUrl(url);
  },
  /** Open a local file or folder with the OS default application. */
  async openWithDefaultApp(path: string): Promise<void> {
    await openPath(path);
  },
  async pathExists(path: string): Promise<boolean> {
    return invoke<boolean>("path_exists", { path });
  },
  /** Check file size before reading data into the webview. */
  async fileSize(path: string): Promise<number> {
    return invoke<number>("file_size", { path });
  },
  async setWindowTitle(title: string): Promise<void> {
    document.title = title;
    await getCurrentWindow().setTitle(title);
  },
  /** Native yes/no dialog (window.confirm is not dependable across Tauri webviews). */
  async confirm(text: string): Promise<boolean> {
    return ask(text, { title: "view-anything", kind: "warning" });
  },
  /** Discard confirmation where cancelling is the default: first (focused) button and Esc decline. */
  async confirmDiscard(text: string): Promise<boolean> {
    const r = await message(text, {
      title: "view-anything",
      kind: "warning",
      buttons: { yes: "계속 편집", no: "버리기", cancel: "취소" },
    });
    return r === "버리기";
  },
  /**
   * Yes/no for a destructive action where the safe answer must be the default: the first
   * (focused) button and Esc both decline; only clicking `dangerLabel` returns true.
   */
  async confirmDanger(text: string, dangerLabel: string): Promise<boolean> {
    const r = await message(text, {
      title: "view-anything",
      kind: "warning",
      buttons: { yes: "저장 안 함", no: dangerLabel, cancel: "취소" },
    });
    return r === dangerLabel;
  },
  /** Non-destructive information (nothing changed, nothing lost). */
  async notice(text: string): Promise<void> {
    await message(text, { title: "view-anything", kind: "info" });
  },
  async alert(text: string): Promise<void> {
    await message(text, { title: "view-anything", kind: "error" });
  },
  /** `allowClose` resolving false keeps the window open. */
  async onCloseRequested(allowClose: () => Promise<boolean>): Promise<void> {
    await getCurrentWindow().onCloseRequested(async (e) => {
      let ok: boolean;
      try {
        ok = await allowClose();
      } catch {
        // A throwing handler would leave the window impossible to close; fall back to the webview.
        ok = window.confirm("저장하지 않은 변경이 있을 수 있습니다. 창을 닫을까요?");
      }
      if (!ok) e.preventDefault();
    });
  },
};
