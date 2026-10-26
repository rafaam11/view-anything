import { invoke, convertFileSrc } from "@tauri-apps/api/core";
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
};
