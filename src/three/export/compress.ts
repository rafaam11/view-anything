// GLB -> EXT_meshopt_compression GLB (glTF-Transform `meshopt()`: reorder + quantize
// (KHR_mesh_quantization) + meshopt encoding). Runs in the export worker; also callable inline.
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

export async function compressGlb(glb: Uint8Array): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const doc = await io.readBinary(glb);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  return io.writeBinary(doc);
}
