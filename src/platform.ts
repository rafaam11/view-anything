import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { THREE_D_EXTENSIONS } from "./three/formats";
import { TEXT_EXTENSIONS } from "./text/formats";
import { showDialog, type DialogKind } from "./ui/dialog";

/** Shows an in-app message with the window raised first (a minimized owner would hide it). */
async function ask<T extends string>(o: Parameters<typeof showDialog<T>>[0]): Promise<T> {
  await platform.bringToFront();
  return showDialog(o);
}

export const platform = {
  async copyImage(png: Uint8Array): Promise<void> {
    await invoke("copy_image_raw", png);
  },
  async copyText(text: string): Promise<void> {
    await invoke("copy_text", { text });
  },
  /** Small files only: the bytes travel as a JSON number array over a synchronous command. Viewers read through `readFileRaw`. */
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
  async writeFileChecked(path: string, expected: Uint8Array, data: Uint8Array): Promise<boolean> {
    const body = new Uint8Array(expected.length + data.length);
    body.set(expected); body.set(data, expected.length);
    return invoke<boolean>("write_file_checked", body, { headers: { "x-va-path": encodeURIComponent(path), "x-va-expected-length": String(expected.length) } });
  },
  async writeFileNew(path: string, data: Uint8Array): Promise<void> {
    await invoke("write_file_new", data, { headers: { "x-va-path": encodeURIComponent(path) } });
  },
  async writeImageCopy(path: string, source: string, data: Uint8Array): Promise<void> {
    await invoke("write_image_copy", data, { headers: { "x-va-path": encodeURIComponent(path), "x-va-source": encodeURIComponent(source) } });
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
  async openWindow(path?: string, text = false): Promise<void> {
    await invoke("open_window", { path: path ?? null, text });
  },
  async decodeCp949(bytes: Uint8Array): Promise<string> {
    return invoke<string>("decode_cp949", bytes);
  },
  async encodeCp949(text: string): Promise<Uint8Array> {
    return new Uint8Array(await invoke<ArrayBuffer>("encode_cp949", { text }));
  },
  /** Native file-open dialog; [] when cancelled. `only3d`: 3D models only (장면에 추가). */
  async pickFiles(opts: { only3d?: boolean; text?: boolean } = {}): Promise<string[]> {
    const models = { name: "3D 모델", extensions: [...THREE_D_EXTENSIONS] };
    const picked = await open({
      multiple: true,
      directory: false,
      filters: opts.text ? [{ name: "텍스트로 열기", extensions: ["*"] }] : opts.only3d
        ? [models]
        : [{ name: "텍스트·코드", extensions: TEXT_EXTENSIONS }, { name: "Markdown", extensions: ["md", "markdown"] }, { name: "PDF", extensions: ["pdf"] }, { name: "데이터", extensions: ["csv", "json", "yaml", "yml"] }, { name: "이미지", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"] }, models, { name: "모든 파일", extensions: ["*"] }],
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
  /** Length and modification time, for cheap change polling. Rejects when the file is missing. */
  async fileStat(path: string): Promise<{ len: number; modified_ms: number | null }> {
    return invoke("file_stat", { path });
  },
  async setFullscreen(on: boolean): Promise<void> {
    await getCurrentWindow().setFullscreen(on);
  },
  async siblingImages(path: string): Promise<string[]> {
    return invoke<string[]>("sibling_images", { path });
  },
  async setWindowTitle(title: string): Promise<void> {
    document.title = title;
    await getCurrentWindow().setTitle(title);
  },
  /**
   * The questions below are in-app dialogs (src/ui/dialog.ts): the window is raised first, the
   * safe answer is focused, and Esc gives it. They look like the app on every platform.
   */
  async confirm(text: string, okLabel = "계속", kind: DialogKind = "warning"): Promise<boolean> {
    return await ask({ message: text, kind, buttons: [{ label: okLabel, value: "ok", variant: "primary" }, { label: "취소", value: "cancel" }], defaultValue: "cancel", cancelValue: "cancel" }) === "ok";
  },
  /** Losing unsaved work: one red button named for what happens (버리기, 닫기, 다시 읽기…). */
  async confirmDiscard(text: string, discardLabel = "버리기"): Promise<boolean> {
    return await ask({ message: text, kind: "warning", buttons: [{ label: discardLabel, value: "discard", variant: "danger" }, { label: "취소", value: "cancel" }], defaultValue: "cancel", cancelValue: "cancel" }) === "discard";
  },
  /** A destructive action: only `dangerLabel` returns true; `safeLabel` and Esc decline. */
  async confirmDanger(text: string, dangerLabel: string, safeLabel = "취소"): Promise<boolean> {
    return await ask({ message: text, kind: "warning", buttons: [{ label: dangerLabel, value: "danger", variant: "danger" }, { label: safeLabel, value: "safe" }], defaultValue: "safe", cancelValue: "safe" }) === "danger";
  },
  /** Information the user must see (nothing lost); "warning" for a conflict that kept their edits. */
  async notice(text: string, kind: DialogKind = "info"): Promise<void> {
    await ask({ message: text, kind, buttons: [{ label: "확인", value: "ok", variant: "primary" }], defaultValue: "ok", cancelValue: "ok" });
  },
  /** A failed user action. */
  async alert(text: string): Promise<void> {
    await ask({ message: text, kind: "error", buttons: [{ label: "확인", value: "ok", variant: "primary" }], defaultValue: "ok", cancelValue: "ok" });
  },
  /** Restore a minimized window and focus it; best effort (a question still shows if this fails). */
  async bringToFront(): Promise<void> {
    try {
      const w = getCurrentWindow();
      if (await w.isMinimized()) await w.unminimize();
      await w.setFocus();
    } catch {
      // Not allowed or not available: the dialog still opens in the window.
    }
  },
  /** `allowClose` resolving false keeps the window open. */
  async onCloseRequested(allowClose: () => Promise<boolean>): Promise<void> {
    let asking = false;
    await getCurrentWindow().onCloseRequested(async (e) => {
      // A second Alt+F4 or close click while the question is open must not stack another one.
      if (asking) { e.preventDefault(); return; }
      asking = true;
      let ok: boolean;
      try {
        ok = await allowClose();
      } catch {
        // A throwing handler would leave the window impossible to close; fall back to the webview.
        ok = window.confirm("저장하지 않은 변경 내용을 버리고 닫을까요?");
      } finally {
        asking = false;
      }
      if (!ok) e.preventDefault();
    });
  },
};
