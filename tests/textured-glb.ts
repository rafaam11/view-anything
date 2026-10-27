// Test helper: a tiny textured GLB (one quad, a 2x2 RGBA PNG base colour texture), built with
// glTF-Transform, node ids in extras.vaId like an export.
import { crc32, deflateSync } from "node:zlib";
import { Document, WebIO } from "@gltf-transform/core";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typed = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  out.set(typed, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typed, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/** A width x height RGBA PNG from `rgba(x, y)`. */
export function png(width: number, height: number, rgba: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    for (let x = 0; x < width; x++) raw.set(rgba(x, y), y * (1 + width * 4) + 1 + x * 4);
  }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Checkerboard: red / blue cells. */
export const CHECKER = png(2, 2, (x, y) => ((x + y) % 2 ? [220, 40, 40, 255] : [40, 80, 220, 255]));

export async function texturedGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const s = 50;
  const position = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0]))
    .setBuffer(buffer);
  const uv = doc
    .createAccessor()
    .setType("VEC2")
    .setArray(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]))
    .setBuffer(buffer);
  const normal = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .setBuffer(buffer);
  const indices = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer);
  const texture = doc.createTexture("checker").setImage(CHECKER).setMimeType("image/png");
  const material = doc.createMaterial("checker").setBaseColorTexture(texture).setDoubleSided(true);
  const prim = doc.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setAttribute("TEXCOORD_0", uv).setIndices(indices).setMaterial(material);
  const mesh = doc.createMesh("quad").addPrimitive(prim);
  const quad = doc.createNode("quad").setMesh(mesh).setExtras({ vaId: "f1/0" });
  const file = doc.createNode("textured.glb").addChild(quad).setExtras({ vaId: "f1" });
  doc.createScene().addChild(file);
  return new WebIO().writeBinary(doc);
}
