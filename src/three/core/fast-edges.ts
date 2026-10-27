// Edge lines with exactly three's EdgesGeometry semantics (same segments, same order) but without
// string keys: vertices are welded on the same 1e-4 grid through a numeric open-addressing hash,
// edges are paired through a second one keyed by the undirected vertex pair (both directions in
// one slot, one probe per triangle edge), and the output is one pre-sized Float32Array. Several
// times faster and far lighter on memory than EdgesGeometry on big meshes (scripts/bench-edges.mjs).
// No three.js: runs in the geometry worker and on the UI thread for small meshes.

const PRECISION = 1e4; // three: precisionPoints = 4
/** Stand-in grid key for NaN coordinates (three's string keys make every NaN equal). */
const NAN_KEY = Number.MAX_VALUE;

function q(v: number): number {
  const r = Math.round(v * PRECISION);
  return r === r ? r : NAN_KEY;
}

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return h ^ (h >>> 16);
}

/** Power-of-two table size keeping the load factor at or below ~2/3. */
function capacityFor(n: number): number {
  let cap = 16;
  while (cap < n * 1.5) cap *= 2;
  return cap;
}

/**
 * Weld id (lowest vertex index on the same 1e-4 grid point, three's vertex hash) of every vertex.
 * Slots hold [vertex + 1, key hash]: grid keys are recomputed only when the hashes match.
 */
export function weldVertices(p: Float32Array): Int32Array {
  const n = Math.floor(p.length / 3);
  const wid = new Int32Array(n);
  const cap = capacityFor(n);
  const mask = cap - 1;
  const slots = new Int32Array(cap * 2);
  for (let v = 0; v < n; v++) {
    const x = q(p[3 * v]);
    const y = q(p[3 * v + 1]);
    const z = q(p[3 * v + 2]);
    // Low 32 bits of each key (large keys only collide more; equality is checked in full).
    const h = mix(Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77) ^ Math.imul(z | 0, 0xc2b2ae3d));
    let s = h & mask;
    for (;;) {
      const e = slots[2 * s];
      if (e === 0) {
        slots[2 * s] = v + 1;
        slots[2 * s + 1] = h;
        wid[v] = v;
        break;
      }
      if (slots[2 * s + 1] === h) {
        const r = e - 1;
        if (q(p[3 * r]) === x && q(p[3 * r + 1]) === y && q(p[3 * r + 2]) === z) {
          wid[v] = r;
          break;
        }
      }
      s = (s + 1) & mask;
    }
  }
  return wid;
}

/**
 * Undirected vertex pair (lo, hi) -> the corner that registered lo->hi and the one that
 * registered hi->lo (each + 1, 0 = none). Stride 4: [lo, hi, cornerUp + 1, cornerDown + 1].
 */
class PairTable {
  private cap: number;
  private mask: number;
  slots: Int32Array;
  private count = 0;

  constructor(expected: number) {
    this.cap = capacityFor(expected);
    this.mask = this.cap - 1;
    this.slots = new Int32Array(this.cap * 4);
  }

  private start(lo: number, hi: number): number {
    return mix(Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi + 0x7f4a7c15, 0x85ebca77)) & this.mask;
  }

  /** Slot offset (into `slots`) of (lo, hi), created empty if absent. */
  find(lo: number, hi: number): number {
    const t = this.slots;
    for (let s = this.start(lo, hi); ; s = (s + 1) & this.mask) {
      const o = 4 * s;
      if (t[o + 2] === 0 && t[o + 3] === 0) {
        if ((this.count + 1) * 3 > this.cap * 2) {
          this.grow();
          return this.find(lo, hi);
        }
        t[o] = lo;
        t[o + 1] = hi;
        this.count++;
        return o;
      }
      if (t[o] === lo && t[o + 1] === hi) return o;
    }
  }

  private grow(): void {
    const old = this.slots;
    this.cap *= 2;
    this.mask = this.cap - 1;
    const t = (this.slots = new Int32Array(this.cap * 4));
    for (let o = 0; o < old.length; o += 4) {
      if (old[o + 2] === 0 && old[o + 3] === 0) continue;
      let s = this.start(old[o], old[o + 1]);
      while (t[4 * s + 2] !== 0 || t[4 * s + 3] !== 0) s = (s + 1) & this.mask;
      t.set(old.subarray(o, o + 4), 4 * s);
    }
  }
}

/**
 * Line segment positions (pairs of xyz) of the edges of a triangle mesh: boundary edges and edges
 * whose face normals differ by at least `thresholdDeg`. Same result as
 * `new EdgesGeometry(geometry, thresholdDeg)` (position attribute), including its order and its
 * handling of degenerate triangles and non-manifold edges.
 */
export function fastEdgePositions(positions: Float32Array, index: ArrayLike<number> | null, thresholdDeg: number): Float32Array {
  const p = positions;
  const count = index ? index.length : Math.floor(p.length / 3);
  const tris = Math.floor(count / 3);
  const corners = tris * 3;
  const thresholdDot = Math.cos((Math.PI / 180) * thresholdDeg);
  const wid = weldVertices(p);
  // Weld id per corner (a triangle soup's corners are its vertices).
  let cw: Int32Array;
  if (index) {
    cw = new Int32Array(corners);
    for (let c = 0; c < corners; c++) cw[c] = wid[index[c]];
  } else cw = wid;
  // Per corner: 1 = registered edge (corner -> next corner), 2 = registered and paired.
  const state = new Uint8Array(corners);
  // Face normal per triangle (filled as triangles are visited; three's Triangle.getNormal).
  const normals = new Float64Array(tris * 3);
  const table = new PairTable(Math.max(16, tris * 1.6));
  let emitted = new Int32Array(Math.max(16, tris >> 2));
  let emitCount = 0;

  for (let t = 0; t < tris; t++) {
    const c0 = 3 * t;
    const w0 = cw[c0], w1 = cw[c0 + 1], w2 = cw[c0 + 2];
    if (w0 === w1 || w1 === w2 || w2 === w0) continue; // degenerate
    const ia = 3 * (index ? index[c0] : c0);
    const ib = 3 * (index ? index[c0 + 1] : c0 + 1);
    const ic = 3 * (index ? index[c0 + 2] : c0 + 2);
    const bx = p[ib], by = p[ib + 1], bz = p[ib + 2];
    const ux = p[ic] - bx, uy = p[ic + 1] - by, uz = p[ic + 2] - bz;
    const vx = p[ia] - bx, vy = p[ia + 1] - by, vz = p[ia + 2] - bz;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const lengthSq = nx * nx + ny * ny + nz * nz;
    if (lengthSq > 0) {
      const s = 1 / Math.sqrt(lengthSq);
      nx *= s;
      ny *= s;
      nz *= s;
    } else nx = ny = nz = 0;
    normals[c0] = nx;
    normals[c0 + 1] = ny;
    normals[c0 + 2] = nz;

    for (let j = 0; j < 3; j++) {
      const corner = c0 + j;
      const a = cw[corner];
      const b = cw[j === 2 ? c0 : corner + 1];
      const up = a < b;
      const o = table.find(up ? a : b, up ? b : a);
      const slots = table.slots;
      const same = o + (up ? 2 : 3);
      const rev = slots[o + (up ? 3 : 2)] - 1;
      if (rev >= 0 && state[rev] === 1) {
        const rt = rev - (rev % 3);
        if (nx * normals[rt] + ny * normals[rt + 1] + nz * normals[rt + 2] <= thresholdDot) {
          if (emitCount === emitted.length) {
            const grown = new Int32Array(emitted.length * 2);
            grown.set(emitted);
            emitted = grown;
          }
          emitted[emitCount++] = corner;
        }
        state[rev] = 2;
      } else if (slots[same] === 0) {
        slots[same] = corner + 1;
        state[corner] = 1;
      }
    }
  }

  let boundary = 0;
  for (let c = 0; c < corners; c++) if (state[c] === 1) boundary++;
  const out = new Float32Array((emitCount + boundary) * 6);
  let o = 0;
  const put = (c: number) => {
    const next = c % 3 === 2 ? c - 2 : c + 1;
    const v0 = 3 * (index ? index[c] : c);
    const v1 = 3 * (index ? index[next] : next);
    out[o++] = p[v0];
    out[o++] = p[v0 + 1];
    out[o++] = p[v0 + 2];
    out[o++] = p[v1];
    out[o++] = p[v1 + 1];
    out[o++] = p[v1 + 2];
  };
  for (let i = 0; i < emitCount; i++) put(emitted[i]);
  for (let c = 0; c < corners; c++) if (state[c] === 1) put(c);
  return out;
}
