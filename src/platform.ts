import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

export const platform = {
  async readFile(path: string): Promise<Uint8Array> {
    return new Uint8Array(await invoke<number[]>("read_file", { path }));
  },
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await invoke("write_file", { path, data: Array.from(data) });
  },
  assetUrl(absPath: string): string {
    return convertFileSrc(absPath);
  },
  async openWindow(path?: string): Promise<void> {
    await invoke("open_window", { path: path ?? null });
  },
  async openExternal(url: string): Promise<void> {
    await openUrl(url);
  },
  async setWindowTitle(title: string): Promise<void> {
    document.title = title;
    await getCurrentWindow().setTitle(title);
  },
  /** Native yes/no dialog (window.confirm is not dependable across Tauri webviews). */
  async confirm(text: string): Promise<boolean> {
    return ask(text, { title: "view-anything", kind: "warning" });
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
