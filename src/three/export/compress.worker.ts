// Export worker: meshopt compression off the UI thread (big scenes take seconds).
import { compressGlb } from "./compress";

self.onmessage = async (e: MessageEvent<{ glb: Uint8Array }>) => {
  try {
    const out = await compressGlb(e.data.glb);
    (self as unknown as Worker).postMessage({ ok: true, glb: out }, [out.buffer as ArrayBuffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
};
