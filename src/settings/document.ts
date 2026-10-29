/** Per-window document options, shown only inside Settings. No file paths are persisted. */
export interface TextSettings {
  encoding(): "utf" | "cp949";
  changeEncoding(value: "utf" | "cp949"): Promise<void>;
}
let text: TextSettings | null = null;
export const textSettings = () => text;
export function registerTextSettings(settings: TextSettings): void { text = settings; }
