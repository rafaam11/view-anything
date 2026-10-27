// Pure helpers for the 3D stage: camera clipping, grid sizing, polar standard views and glTF
// sibling-path resolution. No three.js, no Tauri.

type V3 = readonly number[];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * OrbitControls cannot look exactly along its orbit axis (camera.up): the screen orientation is
 * undefined there. For views parallel to the axis (top/bottom), lean the camera direction by
 * `eps` away from the wanted screen-up so the projected orbit axis lands on `viewUp`.
 * All vectors in the same (world) frame; `dir` is target -> camera.
 */
export function orbitDirection(dir: V3, viewUp: V3, orbitUp: V3, eps = 1e-3): number[] {
  const along = dot(dir, orbitUp);
  if (Math.abs(along) < 1 - 1e-9) return [dir[0], dir[1], dir[2]];
  const s = along > 0 ? -eps : eps;
  const d = [dir[0] + s * viewUp[0], dir[1] + s * viewUp[1], dir[2] + s * viewUp[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return d.map((x) => x / l);
}

/** Near/far planes for a camera `distance` from the centre of a bounding sphere of `radius`. */
export function clipPlanes(distance: number, radius: number): { near: number; far: number } {
  const r = Math.max(radius, 1e-6);
  const near = Math.max(distance - r, r * 1e-3);
  const far = Math.max(distance + r, near + r);
  return { near, far };
}

/** Grid with power-of-ten cells sized to cover a model of `radius` (about 4x its radius). */
export function gridSpec(radius: number): { cell: number; divisions: number; size: number } {
  const r = radius > 0 && Number.isFinite(radius) ? radius : 1;
  const cell = 10 ** Math.floor(Math.log10(r / 2));
  const divisions = Math.max(2, Math.ceil((4 * r) / cell));
  return { cell, divisions, size: cell * divisions };
}

/**
 * Resolve a glTF-relative URI (external .bin, textures) against the model file's folder. Only
 * relative paths are accepted: absolute paths, UNC, drive letters and other schemes return null,
 * so a model cannot make the viewer read arbitrary files. `..` cannot climb above the root.
 */
export function resolveSibling(modelPath: string, uri: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return null;
  let rel = uri;
  try {
    rel = decodeURIComponent(uri);
  } catch {
    // Not valid percent-encoding: use it verbatim.
  }
  if (/^[\\/]/.test(rel) || /^[a-z]:/i.test(rel)) return null;

  const sep = modelPath.includes("\\") ? "\\" : "/";
  const parts = modelPath.split(/[\\/]/);
  parts.pop(); // the model file itself
  const rootLength = parts[0] === "" && parts[1] === "" ? 4 : 1; // UNC \\srv\share, else "/" or "C:"
  const root = parts.slice(0, rootLength);
  const dirs = parts.slice(rootLength);
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") dirs.pop();
    else dirs.push(seg);
  }
  return [...root, ...dirs].join(sep);
}
