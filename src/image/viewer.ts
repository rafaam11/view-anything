import "./viewer.css";
import { platform } from "../platform";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";

const MAX_BYTES = 100 * 1024 * 1024, MAX_PIXELS = 50_000_000;
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const button = (text: string) => { const b = document.createElement("button"); b.textContent = text; return b; };

const viewer: Viewer = {
  async mount(el, initial) {
    let path = initial, files = await platform.siblingImages(path), url = "", dirty = false, edited = false, approved = false, busy = false, scale = 1;
    let original: HTMLImageElement | null = null;
    const root = document.createElement("div"); root.className = "image-root";
    const bar = document.createElement("header"); bar.className = "image-bar";
    const title = document.createElement("strong");
    const prev = button("이전"), next = button("다음"), zoomOut = button("축소"), zoomIn = button("확대"), rotate = button("회전"), flip = button("좌우 반전"), crop = button("자르기"), save = button("PNG로 저장");
    bar.append(title, prev, next, zoomOut, zoomIn, rotate, flip, crop, save);
    const coords = document.createElement("div"); coords.className = "image-coords";
    const inputs = ["X", "Y", "너비", "높이"].map(label => {
      const wrap = document.createElement("label"); wrap.textContent = label + " ";
      const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.value = "0";
      wrap.append(input); coords.append(wrap); return input;
    });
    const area = document.createElement("div"); area.className = "image-area";
    const image = document.createElement("img"); image.alt = "이미지";
    const canvas = document.createElement("canvas"); canvas.hidden = true; area.append(image, canvas);
    const thumbs = document.createElement("nav"); thumbs.className = "image-thumbs"; thumbs.setAttribute("aria-label", "같은 폴더 이미지");
    root.append(bar, coords, area, thumbs); el.replaceChildren(root);
    const report = (e: unknown) => { void platform.alert(String(e)).catch(() => {}); };
    const refresh = () => { title.textContent = (dirty ? "● " : "") + nameOf(path); void platform.setWindowTitle(title.textContent).catch(() => {}); };
    const applyScale = () => { const target = edited ? canvas : image; target.style.width = `${(edited ? canvas.width : image.naturalWidth) * scale}px`; };
    const confirmLeave = async () => approved || !dirty || await platform.confirmDiscard("저장하지 않은 이미지 편집을 버릴까요?");
    const load = async (target: string) => {
      if (await platform.fileSize(target) > MAX_BYTES) throw new Error("이미지가 100 MiB를 초과합니다.");
      const bytes = await platform.readFileRaw(target);
      const ext = target.split(".").pop()?.toLowerCase();
      const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      const nextUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const candidate = new Image(); candidate.src = nextUrl;
      try { await candidate.decode(); } catch (e) { URL.revokeObjectURL(nextUrl); throw e; }
      if (candidate.naturalWidth * candidate.naturalHeight > MAX_PIXELS) { URL.revokeObjectURL(nextUrl); throw new Error("이미지가 5천만 픽셀을 초과합니다."); }
      if (url) URL.revokeObjectURL(url);
      path = target; url = nextUrl; original = candidate; image.src = url; dirty = false; edited = false; scale = 1;
      canvas.hidden = true; image.hidden = false; inputs[0].value = "0"; inputs[1].value = "0";
      inputs[2].value = String(candidate.naturalWidth); inputs[3].value = String(candidate.naturalHeight);
      refresh(); applyScale();
    };
    const navigate = async (target: string) => {
      if (busy || target === path) return; busy = true;
      try { if (await confirmLeave()) await load(target); } finally { busy = false; }
    };
    const draw = (transform: "rotate" | "flip" | "crop") => {
      if (!original || busy) return;
      const src: CanvasImageSource = edited ? canvas : original;
      const w = edited ? canvas.width : original.naturalWidth, h = edited ? canvas.height : original.naturalHeight;
      const tmp = document.createElement("canvas");
      if (transform === "crop") {
        const [x, y, cw, ch] = inputs.map(i => Number(i.value));
        if (![x, y, cw, ch].every(Number.isInteger) || x < 0 || y < 0 || cw < 1 || ch < 1 || x + cw > w || y + ch > h) throw new Error("자르기 영역이 이미지 범위를 벗어났습니다.");
        tmp.width = cw; tmp.height = ch; tmp.getContext("2d")!.drawImage(src, x, y, cw, ch, 0, 0, cw, ch);
      } else {
        tmp.width = transform === "rotate" ? h : w; tmp.height = transform === "rotate" ? w : h;
        const ctx = tmp.getContext("2d")!;
        if (transform === "rotate") { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
        else { ctx.translate(w, 0); ctx.scale(-1, 1); }
        ctx.drawImage(src, 0, 0);
      }
      canvas.width = tmp.width; canvas.height = tmp.height; canvas.getContext("2d")!.drawImage(tmp, 0, 0);
      dirty = true; edited = true; image.hidden = true; canvas.hidden = false;
      inputs[0].value = "0"; inputs[1].value = "0"; inputs[2].value = String(canvas.width); inputs[3].value = String(canvas.height);
      refresh(); applyScale();
    };
    rotate.onclick = () => { try { draw("rotate"); } catch (e) { report(e); } };
    flip.onclick = () => { try { draw("flip"); } catch (e) { report(e); } };
    crop.onclick = () => { try { draw("crop"); } catch (e) { report(e); } };
    zoomIn.onclick = () => { scale = Math.min(8, scale * 1.25); applyScale(); };
    zoomOut.onclick = () => { scale = Math.max(.05, scale / 1.25); applyScale(); };
    const move = (n: number) => { const i = files.findIndex(f => f.toLowerCase() === path.toLowerCase()); const target = files[i + n]; if (target) void navigate(target).catch(report); };
    prev.onclick = () => move(-1); next.onclick = () => move(1);
    save.onclick = () => { void (async () => {
      if (!dirty || busy) return; busy = true;
      try {
        const target = await platform.saveDialog({ defaultPath: path.replace(/\.[^.]+$/, "-edited.png"), filters: [{ name: "PNG", extensions: ["png"] }] });
        if (!target) return;
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG 변환 실패")), "image/png"));
        await platform.writeImageCopy(target, path, new Uint8Array(await blob.arrayBuffer()));
        dirty = false; refresh(); await platform.notice("편집 이미지를 저장했습니다.");
      } finally { busy = false; }
    })().catch(report); };
    for (const file of files.slice(0, 1000)) {
      const b = button(""); b.title = nameOf(file); b.setAttribute("aria-label", nameOf(file));
      const thumb = document.createElement("img"); thumb.loading = "lazy"; thumb.src = platform.assetUrl(file); thumb.alt = ""; b.append(thumb);
      b.onclick = () => { void navigate(file).catch(report); }; thumbs.append(b);
    }
    registerUpdateGuard(() => dirty || busy, value => { approved = value; });
    await platform.onCloseRequested(confirmLeave);
    window.addEventListener("beforeunload", e => { if (!approved && dirty) e.preventDefault(); });
    window.addEventListener("unload", () => { if (url) URL.revokeObjectURL(url); });
    await load(initial);
  },
};
export default viewer;
