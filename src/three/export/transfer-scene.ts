// Transfer geometry as typed buffers, never giant JSON number arrays. The live scene is untouched.
import { BufferAttribute, BufferGeometry, ObjectLoader, TextureSource, type Material, type Mesh, type Object3D, type Texture } from "three";

interface Attribute { values: Float32Array; size: number }
interface Geometry { attributes: Record<string, Attribute>; index: Uint32Array | null; groups: BufferGeometry["groups"]; drawRange: BufferGeometry["drawRange"] }
export interface ScenePacket {
  object: unknown;
  materials: unknown[];
  textures: unknown[];
  geometries: Record<string, Geometry>;
  images: Record<string, ImageBitmap>;
}
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function packScene(scene: Object3D): Promise<{ packet: ScenePacket; transfer: Transferable[] }> {
  const geometrySet = new Set<BufferGeometry>();
  const textureSet = new Set<Texture>();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry) geometrySet.add(mesh.geometry);
    if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m as Material)) if (v && (v as Texture).isTexture) textureSet.add(v as Texture);
    }
  });
  const meta = { geometries: {}, materials: {}, textures: {}, images: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} } as Record<string, Record<string, unknown>>;
  const packet: ScenePacket = { object: null, materials: [], textures: [], geometries: {}, images: {} };
  const transfer: Transferable[] = [];
  try {
    for (const g of geometrySet) {
      meta.geometries[g.uuid] = { uuid: g.uuid }; // avoid BufferGeometry.toJSON's synchronous array expansion
      const attributes: Record<string, Attribute> = {};
      for (const [name, attr] of Object.entries(g.attributes)) {
        const values = new Float32Array(attr.count * attr.itemSize);
        for (let start = 0; start < attr.count; start += 65_536) {
          await pause();
          const end = Math.min(start + 65_536, attr.count);
          for (let i = start; i < end; i++) for (let k = 0; k < attr.itemSize; k++) values[i * attr.itemSize + k] = attr.getComponent(i, k);
        }
        attributes[name] = { values, size: attr.itemSize };
        transfer.push(values.buffer);
      }
      const index = g.index ? new Uint32Array(g.index.count) : null;
      if (index && g.index) {
        for (let start = 0; start < index.length; start += 196_608) {
          await pause();
          index.set(g.index.array.subarray(start, start + 196_608), start);
        }
        transfer.push(index.buffer);
      }
      packet.geometries[g.uuid] = { attributes, index, groups: g.groups, drawRange: g.drawRange };
    }
    for (const texture of textureSet) {
      const id = texture.source.uuid;
      if (packet.images[id]) continue;
      const source = texture.image as ImageBitmapSource & { data?: Uint8Array; width: number; height: number };
      if (source?.data && (!(source.data instanceof Uint8Array) || source.data.length !== source.width * source.height * 4)) {
        throw new Error("지원하지 않는 데이터 텍스처 형식입니다 (RGBA8 필요).");
      }
      // GLTFLoader supplies ImageBitmaps; regular image/canvas sources work as well.
      const image = source?.data
        ? new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
        : source;
      const bitmap = await createImageBitmap(image, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      packet.images[id] = bitmap;
      meta.images[id] = { uuid: id };
      transfer.push(bitmap);
    }
    packet.object = scene.toJSON(meta as unknown as Parameters<Object3D["toJSON"]>[0]).object;
    packet.materials = Object.values(meta.materials);
    packet.textures = Object.values(meta.textures);
    return { packet, transfer };
  } catch (error) {
    Object.values(packet.images).forEach((image) => image.close());
    throw error;
  }
}

export function unpackScene(packet: ScenePacket): Object3D {
  const geometries: Record<string, BufferGeometry> = {};
  for (const [id, data] of Object.entries(packet.geometries)) {
    const g = new BufferGeometry();
    for (const [name, attr] of Object.entries(data.attributes)) g.setAttribute(name, new BufferAttribute(attr.values, attr.size));
    if (data.index) g.setIndex(new BufferAttribute(data.index, 1));
    g.groups = data.groups;
    g.drawRange = data.drawRange;
    geometries[id] = g;
  }
  const loader = new ObjectLoader();
  const images = Object.fromEntries(Object.entries(packet.images).map(([id, image]) => [id, new TextureSource(image)]));
  const textures = loader.parseTextures(packet.textures, images);
  const materials = loader.parseMaterials(packet.materials, textures);
  // three r186 added the textures argument; @types/three r186.0 still has the earlier signature.
  const parse = loader.parseObject as unknown as (object: unknown, g: typeof geometries, m: typeof materials, t: typeof textures, a: object) => Object3D;
  return parse.call(loader, packet.object, geometries, materials, textures, {});
}
