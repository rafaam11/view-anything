import { Color, DoubleSide, Mesh, MeshBasicMaterial, NoBlending, NoColorSpace, NoToneMapping, Points, PointsMaterial, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type Material, type Object3D, type Plane } from "three";
import type { Stage } from "../core/stage";

/** One-pixel ID pass. All visible models occlude the selected cloud; source IDs never go through a raycaster. */
export function pickCloud(stage: Stage, selected: Object3D, x: number, y: number, planes: Plane[]): number | null {
  const rect = stage.canvas.getBoundingClientRect(), renderer = stage.renderer;
  if (!rect.width || !rect.height) return null;
  const size = renderer.getDrawingBufferSize(new Vector2());
  const camera = stage.camera.clone();
  camera.setViewOffset(size.x, size.y, Math.floor((x - rect.left) / rect.width * size.x), Math.floor((y - rect.top) / rect.height * size.y), 1, 1);
  camera.updateMatrixWorld();
  const scene = new Scene(); scene.background = new Color(0);
  const materials: Material[] = [];
  stage.scene.updateMatrixWorld(true);
  const chosen = new Set<Object3D>(); selected.traverse((o) => chosen.add(o));
  stage.content.traverseVisible((o) => {
    const source = o as Mesh | Points;
    if (!((source as Mesh).isMesh || (source as Points).isPoints) || o.userData.vaPending) return;
    let clone: Object3D;
    if ((source as Points).isPoints) {
      const size = (source.material as PointsMaterial).size;
      const material = chosen.has(o) ? new ShaderMaterial({
        uniforms: { pointSize: { value: size * renderer.getPixelRatio() } },
        vertexShader: `attribute vec3 vaPick; varying vec3 vId; uniform float pointSize;
          #include <clipping_planes_pars_vertex>
          void main() { vId=vaPick; vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
            gl_Position=projectionMatrix*mvPosition; gl_PointSize=pointSize;
            #include <clipping_planes_vertex>
          }`,
        fragmentShader: `varying vec3 vId;
          #include <clipping_planes_pars_fragment>
          void main() {
            #include <clipping_planes_fragment>
            gl_FragColor=vec4(vId,1.0);
          }`, clipping: true, clippingPlanes: planes, blending: NoBlending, toneMapped: false,
      }) : new PointsMaterial({ color: 0, size, sizeAttenuation: false, clippingPlanes: planes, toneMapped: false });
      materials.push(material); clone = new Points(source.geometry, material);
    } else {
      const material = new MeshBasicMaterial({ color: 0, side: DoubleSide, clippingPlanes: planes, toneMapped: false }); materials.push(material); clone = new Mesh(source.geometry, material);
    }
    clone.matrixAutoUpdate = false; clone.matrix.copy(source.matrixWorld); scene.add(clone);
  });
  const target = new WebGLRenderTarget(1, 1); target.texture.colorSpace = NoColorSpace;
  const oldTarget = renderer.getRenderTarget(), oldTone = renderer.toneMapping, oldAuto = renderer.autoClear;
  try {
    renderer.toneMapping = NoToneMapping; renderer.autoClear = true; renderer.setRenderTarget(target); renderer.render(scene, camera);
    const pixel = new Uint8Array(4); renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
    const id = pixel[0] + pixel[1] * 256 + pixel[2] * 65536; return id === 0 ? null : id - 1;
  } finally { renderer.setRenderTarget(oldTarget); renderer.toneMapping = oldTone; renderer.autoClear = oldAuto; target.dispose(); materials.forEach((m) => m.dispose()); stage.requestRender(); }
}
