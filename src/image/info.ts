/** "1.2 MiB": binary units, matching the viewer's size limits. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The format comes from the extension, like the MIME type the viewer decodes with. */
export function imageFormat(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path, dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot + 1).toUpperCase();
  return ext === "JPEG" ? "JPG" : ext;
}

/** The file size only describes the file on disk, so an edited canvas does not show it. */
export function describeImage(image: { width: number; height: number; path: string; bytes: number; edited: boolean }): string {
  const size = `${image.width}×${image.height}`;
  if (image.edited) return `${size} · 편집 중`;
  return [size, imageFormat(image.path), formatBytes(image.bytes)].filter(Boolean).join(" · ");
}
