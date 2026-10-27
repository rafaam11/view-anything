// Exported HTML size limit: above it the user confirms before saving (big files open slowly).

export const SIZE_WARN_BYTES = 50 * 1024 * 1024;

export function exceedsSizeWarning(bytes: number): boolean {
  return bytes > SIZE_WARN_BYTES;
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
