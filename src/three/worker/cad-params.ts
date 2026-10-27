// occt-import-js tessellation parameters for STEP/IGES. Pure (no wasm), so the UI can decide
// whether a coarser retry is still possible without loading occt.

export interface OcctParams {
  /** Always millimetres: STEP/IGES files are unified to mm whatever unit they were written in. */
  linearUnit: "millimeter";
  linearDeflectionType: "bounding_box_ratio";
  /** Chordal deviation as a ratio of the average bounding-box size. */
  linearDeflection: number;
  /** Angular deviation in radians. */
  angularDeflection: number;
}

const MiB = 1 << 20;

/**
 * Deflection by file size (bytes, inclusive upper bound): small files are meshed finely, large
 * ones coarsely so tessellation time and wasm memory stay bounded. Tier 0 is occt-import-js's
 * own default (0.001 / 0.5).
 */
export const DEFLECTION_TIERS: readonly { upTo: number; linear: number; angular: number }[] = [
  { upTo: 10 * MiB, linear: 0.001, angular: 0.5 },
  { upTo: 50 * MiB, linear: 0.003, angular: 0.6 },
  { upTo: 150 * MiB, linear: 0.01, angular: 0.8 },
  { upTo: Infinity, linear: 0.03, angular: 1.0 },
];

/** Past the last tier each retry triples the linear deflection, up to this ratio. */
export const MAX_LINEAR_DEFLECTION = 0.3;

/**
 * Params for a file of `byteLength` bytes after `coarser` "정밀도를 낮춰 다시 시도" retries: each
 * retry moves one tier coarser, then triples the linear deflection (capped).
 */
export function occtParams(byteLength: number, coarser = 0): OcctParams {
  const base = DEFLECTION_TIERS.findIndex((t) => byteLength <= t.upTo);
  const level = base + Math.max(0, Math.floor(coarser));
  const last = DEFLECTION_TIERS.length - 1;
  const tier = DEFLECTION_TIERS[Math.min(level, last)];
  let linear = tier.linear;
  if (level > last) linear = Math.min(MAX_LINEAR_DEFLECTION, +(linear * 3 ** (level - last)).toPrecision(6));
  return { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: linear, angularDeflection: tier.angular };
}

/** Whether one more retry would actually tessellate more coarsely. */
export function canCoarsen(byteLength: number, coarser: number): boolean {
  return occtParams(byteLength, coarser + 1).linearDeflection > occtParams(byteLength, coarser).linearDeflection;
}
