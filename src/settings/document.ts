/** Per-window document options, shown only inside Settings. No file paths are persisted. */
import { TEXT_EXTENSIONS } from "../text/formats";
export type SettingsContext = "empty" | "markdown" | "text" | "other";
export interface TextSettings {
  encoding(): "utf" | "cp949";
  changeEncoding(value: "utf" | "cp949"): Promise<void>;
}
let text: TextSettings | null = null;
let context: SettingsContext = "empty";
export const settingsContext = () => context;
export const textSettings = () => text;
export function configureSettings(path: string | null, explicitText = false): void {
  const name = path?.split(/[\\/]/).pop() ?? "", dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  context = !path ? "empty" : explicitText || TEXT_EXTENSIONS.includes(ext) ? "text" : ["md", "markdown"].includes(ext) ? "markdown" : "other";
  text = null; window.dispatchEvent(new Event("va:settings-context"));
}
export function registerTextSettings(settings: TextSettings): void {
  text = settings; context = "text"; window.dispatchEvent(new Event("va:settings-context"));
}
