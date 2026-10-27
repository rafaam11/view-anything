// Edge lines and BVHs for the 3D stage, off the UI thread (see core/geometry-jobs.ts).
import { bvhData, edgePositions, type GeometryInput, type JobKind } from "../core/geometry-jobs";

interface Request {
  id: number;
  kind: JobKind;
  input: GeometryInput;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, kind, input } = e.data;
  try {
    if (kind === "edges") {
      const positions = edgePositions(input);
      (self as unknown as Worker).postMessage({ id, result: positions }, [positions.buffer]);
    } else {
      const data = bvhData(input);
      const transfer: Transferable[] = [...data.roots];
      if (data.indirectBuffer) transfer.push(data.indirectBuffer.buffer);
      (self as unknown as Worker).postMessage({ id, result: data }, transfer);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
