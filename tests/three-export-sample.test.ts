// @vitest-environment happy-dom
// Writes a real exported HTML (fixtures -> export scene -> GLB -> meshopt -> template with the
// built runtime) for a manual / headless-browser check. Opt-in: VA_SAMPLE_OUT=<dir> and a built
// runtime (npm run build:runtime).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Box3, Matrix4, Vector3 } from "three";
import { loadOcct, readCad } from "../src/three/worker/occt";
import { occtParams } from "../src/three/worker/cad-params";
import { parseMesh } from "../src/three/worker/parse-mesh";
import { buildParsedFile } from "../src/three/core/build-objects";
import { buildTree } from "../src/three/core/scene-model";
import { displayRootMatrix, objectMatrix } from "../src/three/core/frames";
import { buildExportScene, exportGlb, exportTree } from "../src/three/export/scene";
import { compressGlb } from "../src/three/export/compress";
import { renderHtml } from "../src/three/export/template";
import { STATE_VERSION, type ExportState } from "../src/three/export/state";
import { texturedGlb } from "./textured-glb";

const OUT = process.env.VA_SAMPLE_OUT;
const RUNTIME = join(__dirname, "..", "build", "runtime", "va-runtime.js");
const FIX = join(__dirname, "fixtures", "3d");

test.skipIf(!OUT || !existsSync(RUNTIME))(
  "sample exported HTML",
  async () => {
    const occt = await loadOcct();
    const stepBytes = new Uint8Array(readFileSync(join(FIX, "assembly.step")));
    const step = readCad(occt, "step", stepBytes, occtParams(stepBytes.byteLength));
    const stepRoot = buildTree(step.tree, "assembly.step", "f1", step.meshes.map((m) => m.name));
    const stepBuilt = buildParsedFile(step, stepRoot);
    // A hostile part name: must show as text in the exported page.
    stepRoot.children[0].name = '</script><img src=x onerror="document.title=\'XSS\'">';

    const objBuffer = readFileSync(join(FIX, "groups.obj"));
    const obj = parseMesh("obj", objBuffer.buffer.slice(objBuffer.byteOffset, objBuffer.byteOffset + objBuffer.byteLength) as ArrayBuffer);
    const objRoot = buildTree(obj.tree, "groups.obj", "f2", obj.meshes.map((m) => m.name));
    const objBuilt = buildParsedFile(obj, objRoot);
    // Y-up inch source on the Z-up mm display, placed next to the assembly.
    objBuilt.group.matrixAutoUpdate = false;
    objBuilt.group.matrix.fromArray(objectMatrix("zup-rh", "mm", "yup-rh", "in")).premultiply(new Matrix4().makeTranslation(120, 0, 0));
    // One OBJ group hidden in the panel: not exported.
    const hidden = objRoot.children[objRoot.children.length - 1];
    hidden.visible = false;
    objBuilt.nodes.get(hidden.id)!.visible = false;

    const sources = [
      { root: stepRoot, group: stepBuilt.group, nodes: stepBuilt.nodes },
      { root: objRoot, group: objBuilt.group, nodes: objBuilt.nodes },
    ];
    const exported = buildExportScene(sources);
    const glb = await exportGlb(exported.scene);
    exported.dispose();
    const packed = await compressGlb(glb);

    // Camera: iso-ish view of the whole scene (world = display root applied).
    const world = new Matrix4().fromArray(displayRootMatrix("zup-rh"));
    const box = new Box3();
    for (const s of sources) {
      s.group.updateMatrixWorld(true);
      box.expandByObject(s.group);
    }
    box.applyMatrix4(world);
    const center = box.getCenter(new Vector3());
    const r = box.getSize(new Vector3()).length();
    const position = center.clone().add(new Vector3(1, 0.8, 1).normalize().multiplyScalar(r * 1.4));

    const state: ExportState = {
      version: STATE_VERSION,
      title: "assembly.step 외 1개",
      display: "zup-rh",
      unit: "mm",
      mode: "edges",
      sections: [
        { enabled: false, value: null },
        { enabled: false, value: null },
        { enabled: false, value: null },
      ],
      camera: { position: position.toArray(), target: center.toArray() },
      panelCollapsed: false,
      files: [
        { id: "f1", name: "assembly.step", format: "step", sourceUnit: "mm", tree: exportTree(stepRoot) },
        { id: "f2", name: "groups.obj", format: "obj", sourceUnit: "in", tree: exportTree(objRoot) },
      ],
    };
    const html = renderHtml({ title: state.title, glb: packed, state, runtime: readFileSync(RUNTIME, "utf8") });
    mkdirSync(OUT!, { recursive: true });
    const file = join(OUT!, "sample-export.html");
    writeFileSync(file, html);
    expect(html.match(/<script\b/gi)).toHaveLength(3);
    console.log(`sample: ${file} (${(html.length / 1024).toFixed(0)} KB, GLB ${glb.byteLength} -> ${packed.byteLength} bytes)`);
  },
  120_000,
);

test.skipIf(!OUT || !existsSync(RUNTIME))("sample exported HTML with an embedded texture", async () => {
  const packed = await compressGlb(await texturedGlb());
  const state: ExportState = {
    version: STATE_VERSION,
    title: "textured.glb",
    display: "zup-rh",
    unit: "mm",
    mode: "solid",
    sections: [0, 1, 2].map(() => ({ enabled: false, value: null })),
    // Looking at the quad (display XY plane at z = 0, world y = 0) from above.
    camera: { position: [0, 160, 0.001], target: [0, 0, 0] },
    panelCollapsed: false,
    files: [
      {
        id: "f1",
        name: "textured.glb",
        format: "glb",
        sourceUnit: "as-is",
        tree: { id: "f1", name: "textured.glb", kind: "file", visible: true, children: [{ id: "f1/0", name: "quad", kind: "mesh", visible: true, children: [] }] },
      },
    ],
  };
  const html = renderHtml({ title: state.title, glb: packed, state, runtime: readFileSync(RUNTIME, "utf8") });
  mkdirSync(OUT!, { recursive: true });
  writeFileSync(join(OUT!, "sample-textured.html"), html);
});
