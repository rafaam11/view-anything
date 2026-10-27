import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { unpackScene, type ScenePacket } from "./transfer-scene";
self.onmessage = async (event: MessageEvent<ScenePacket>) => {
  try {
    const scene = unpackScene(event.data);
    scene.updateMatrixWorld(true);
    const result = await new GLTFExporter().parseAsync(scene, { binary: true });
    if (!(result instanceof ArrayBuffer)) throw new Error("GLTFExporter did not return a GLB");
    (self as unknown as Worker).postMessage({ result }, [result]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: String(error) });
  } finally { Object.values(event.data.images).forEach((image) => image.close()); }
};
