// 3D format detection. Must stay free of three.js imports: the registry and the
// file dialog use it from the entry chunk.

export type ThreeDFormat = "stl" | "obj" | "ply" | "gltf" | "glb" | "step" | "iges";

const BY_EXTENSION: Readonly<Record<string, ThreeDFormat>> = {
  stl: "stl",
  obj: "obj",
  ply: "ply",
  gltf: "gltf",
  glb: "glb",
  step: "step",
  stp: "step",
  iges: "iges",
  igs: "iges",
};

/** Lower-case file extensions (without dot) the 3D viewer opens. */
export const THREE_D_EXTENSIONS: readonly string[] = Object.freeze(Object.keys(BY_EXTENSION));

function extensionOf(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : name.slice(dot + 1).toLowerCase();
}

export function formatOf(path: string): ThreeDFormat | null {
  const ext = extensionOf(path);
  return ext !== null && Object.prototype.hasOwnProperty.call(BY_EXTENSION, ext) ? BY_EXTENSION[ext] : null;
}

export function isThreeD(path: string): boolean {
  return formatOf(path) !== null;
}

const SOLID = [0x73, 0x6f, 0x6c, 0x69, 0x64]; // "solid"

function startsWithSolid(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length && i < 80 && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return SOLID.every((c, k) => bytes[i + k] === c);
}

/**
 * Binary STL = 80-byte header + uint32 triangle count + 50 bytes per triangle. The size formula
 * wins over the header text, because many exporters write binary files whose header starts
 * with "solid".
 */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
  if (84 + 50 * count === bytes.length) return true;
  return !startsWithSolid(bytes);
}
