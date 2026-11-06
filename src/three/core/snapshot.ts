// Screen capture shared by the app viewer and the exported-HTML runtime. No Tauri.

/**
 * PNG of what `render` just drew. The WebGL drawing buffer is only valid until the browser
 * composites, so the capture happens in the same task as the render.
 */
export function snapshotCanvas(render: () => void, canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    render();
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("화면을 이미지로 만들 수 없습니다"))), "image/png");
  });
}

/** Save a blob from a plain web page (the exported HTML) through a temporary download link. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  try { link.click(); } finally { link.remove(); URL.revokeObjectURL(url); }
}
