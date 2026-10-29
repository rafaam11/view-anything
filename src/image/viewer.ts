import "./viewer.css";
import { platform } from "../platform";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";
import { equalBytes } from "../data/document";
import { documentBar } from "../ui/chrome";
import { iconButton } from "../ui/icons";

const MAX_BYTES = 100 * 1024 * 1024, MAX_PIXELS = 50_000_000;
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const pathKey = (p: string) => { const normalized = p.replace(/\\/g, "/"); return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized; };
const button = (text: string) => { const b = document.createElement("button"); b.textContent = text; return b; };

const viewer: Viewer = {
  async mount(el, initial) {
    let path = initial, files = await platform.siblingImages(path), url = "", dirty = false, edited = false, approved = false, busy = false, scale = 1, editing = false, fitted = true;
    let original: HTMLImageElement | null = null, known = new Uint8Array();
    const root = document.createElement("div"); root.className = "image-root va-viewer";
    const bar = document.createElement("header"); bar.className = "image-bar";
    const title = document.createElement("strong");
    const status = document.createElement("span"); status.setAttribute("role", "status");
    const prev = iconButton("이전 이미지", "previous", "ArrowLeft"), next = iconButton("다음 이미지", "next", "ArrowRight");
    const zoomOut = iconButton("축소", "minus"), zoomIn = iconButton("확대", "plus"), fit = iconButton("화면에 맞춤", "fit", "Ctrl+0");
    const rotate = iconButton("회전", "rotate"), flip = iconButton("좌우 반전", "flip"), cropToggle = iconButton("자르기", "crop");
    const copy = iconButton("이미지 복사", "copy", "Ctrl+C"), toggle = iconButton("이미지 편집", "edit"), save = button("PNG로 저장"), crop = button("자르기 적용");
    const zoomLabel = document.createElement("span"); zoomLabel.className = "image-zoom";
    const coords = document.createElement("div"); coords.className = "image-coords va-search"; coords.hidden = true;
    const inputs = ["X", "Y", "너비", "높이"].map(label => {
      const wrap = document.createElement("label"); wrap.textContent = label + " ";
      const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.value = "0";
      wrap.append(input); coords.append(wrap); return input;
    });
    const cancelCrop = iconButton("자르기 취소", "close"); cancelCrop.onclick = () => { coords.hidden = true; }; coords.append(crop, cancelCrop);
    const area = document.createElement("div"); area.className = "image-area";
    const image = document.createElement("img"); image.alt = "이미지";
    const canvas = document.createElement("canvas"); canvas.hidden = true;
    const surface = document.createElement("div"); surface.className = "image-surface"; surface.append(image, canvas); area.append(surface);
    const thumbs = document.createElement("nav"); thumbs.className = "image-thumbs"; thumbs.setAttribute("aria-label", "같은 폴더 이미지");
    thumbs.hidden = true; status.className = "va-status";
    const actual = button("원본 크기 (100%)"); actual.onclick = () => setZoom(1);
    documentBar(bar, { files:[save], controls:[prev, next, zoomOut, zoomLabel, zoomIn, fit, copy, rotate, flip, cropToggle, toggle], view:[
      { label:"화면에 맞춤", run:() => fit.click() }, { label:"원본 크기 (100%)", run:() => actual.click() },
      { label:"썸네일", checked:() => !thumbs.hidden, run:() => { thumbs.hidden = !thumbs.hidden; applyScale(); } },
    ] });
    root.append(bar, coords, area, thumbs, status); el.replaceChildren(root);
    const report = (e: unknown) => { void platform.alert(String(e)).catch(() => {}); };
    const refresh = () => {
      title.textContent = (dirty ? "● " : "") + nameOf(path); void platform.setWindowTitle(title.textContent).catch(() => {});
      const index = files.findIndex(f => pathKey(f) === pathKey(path)); prev.disabled = busy || index <= 0; next.disabled = busy || index < 0 || index + 1 >= files.length;
      rotate.hidden = flip.hidden = cropToggle.hidden = save.hidden = !editing;
      for (const b of [copy, rotate, flip, cropToggle, toggle]) b.disabled = busy;
      toggle.setAttribute("aria-pressed", String(editing));
    };
    const applyScale = () => {
      const target = edited ? canvas : image, w = edited ? canvas.width : original?.naturalWidth ?? 0, h = edited ? canvas.height : original?.naturalHeight ?? 0;
      if (fitted && w && h) scale = Math.max(.01, Math.min(1, (area.clientWidth - 32) / w, (area.clientHeight - 32) / h));
      target.style.width = `${w * scale}px`;
      surface.style.width = `${Math.max(area.clientWidth, w * scale + 32)}px`; surface.style.height = `${Math.max(area.clientHeight, h * scale + 32)}px`;
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    };
    const setZoom = (value: number, point?: { x:number; y:number }) => {
      const target = edited ? canvas : image, before = target.getBoundingClientRect(), rect = area.getBoundingClientRect();
      const x = point?.x ?? rect.left + area.clientWidth / 2, y = point?.y ?? rect.top + area.clientHeight / 2;
      const u = before.width ? Math.max(0, Math.min(1, (x-before.left)/before.width)) : .5;
      const v = before.height ? Math.max(0, Math.min(1, (y-before.top)/before.height)) : .5;
      fitted = false; scale = Math.max(.01, Math.min(16, value)); applyScale();
      const after = target.getBoundingClientRect(); area.scrollLeft += after.left + u*after.width - x; area.scrollTop += after.top + v*after.height - y;
    };
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
      path = target; url = nextUrl; original = candidate; known = new Uint8Array(bytes); image.src = url; dirty = false; edited = false; scale = 1; status.textContent = "";
      fitted = true; coords.hidden = true; editing = false;
      canvas.hidden = true; image.hidden = false; inputs[0].value = "0"; inputs[1].value = "0";
      inputs[2].value = String(candidate.naturalWidth); inputs[3].value = String(candidate.naturalHeight);
      refresh(); applyScale();
    };
    const navigate = async (target: string) => {
      if (busy || target === path) return; busy = true;
      refresh(); try { if (await confirmLeave()) await load(target); } finally { busy = false; refresh(); }
    };
    const draw = (transform: "rotate" | "flip" | "crop") => {
      if (!original || busy || !editing) return;
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
      coords.hidden = true; refresh(); applyScale();
    };
    rotate.onclick = () => { try { draw("rotate"); } catch (e) { report(e); } };
    flip.onclick = () => { try { draw("flip"); } catch (e) { report(e); } };
    crop.onclick = () => { try { draw("crop"); } catch (e) { report(e); } };
    zoomIn.onclick = () => setZoom(scale * 1.25);
    zoomOut.onclick = () => setZoom(scale / 1.25);
    fit.onclick = () => { fitted = true; applyScale(); };
    cropToggle.onclick = () => { if (editing && !busy) coords.hidden = !coords.hidden; };
    toggle.onclick = () => { void (async () => {
      if (busy) return;
      busy = true; refresh();
      try {
        if (editing && dirty) { if (!await confirmLeave()) return; await load(path); }
        else editing = !editing;
        coords.hidden = true;
      } finally { busy = false; refresh(); }
    })().catch(report); };
    area.addEventListener("wheel", e => {
      if (!e.ctrlKey || !e.deltaY) return; e.preventDefault();
      setZoom(scale * Math.exp(-Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? area.clientHeight : 1))) * .002), {x:e.clientX, y:e.clientY});
    }, { passive:false });
    let pan: { x:number; y:number; left:number; top:number } | null = null;
    area.onpointerdown = e => { if (e.button !== 0) return; e.preventDefault(); area.setPointerCapture(e.pointerId); pan = {x:e.clientX,y:e.clientY,left:area.scrollLeft,top:area.scrollTop}; area.classList.add("panning"); };
    area.onpointermove = e => { if (pan) { area.scrollLeft = pan.left + pan.x - e.clientX; area.scrollTop = pan.top + pan.y - e.clientY; } };
    const endPan = () => { pan = null; area.classList.remove("panning"); }; area.onpointerup = endPan; area.onpointercancel = endPan; area.onlostpointercapture = endPan;
    area.ondblclick = () => fitted ? setZoom(1) : fit.click();
    copy.onclick = () => { void (async () => {
      if (!original || busy) return; busy = true; refresh();
      try {
        const snapshot = document.createElement("canvas"); snapshot.width = edited ? canvas.width : original.naturalWidth; snapshot.height = edited ? canvas.height : original.naturalHeight;
        snapshot.getContext("2d")!.drawImage(edited ? canvas : original, 0, 0);
        const blob = await new Promise<Blob>((resolve,reject) => snapshot.toBlob(b => b ? resolve(b) : reject(Error("이미지 복사 실패")), "image/png"));
        await platform.copyImage(new Uint8Array(await blob.arrayBuffer())); status.textContent = "이미지를 복사했습니다.";
      } finally { busy = false; refresh(); }
    })().catch(report); };
    window.addEventListener("keydown", e => {
      if (document.querySelector("dialog[open]") || (e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable=true]")) return;
      if (e.ctrlKey && e.key.toLowerCase() === "c") { e.preventDefault(); if (!e.repeat) copy.click(); }
      else if (e.ctrlKey && e.key === "0") { e.preventDefault(); fit.click(); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomIn.click(); }
      else if (e.key === "-") { e.preventDefault(); zoomOut.click(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev.click(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next.click(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); save.click(); }
    });
    let resizeFrame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; applyScale(); });
    }); resize.observe(area);
    const move = (n: number) => { const i = files.findIndex(f => pathKey(f) === pathKey(path)); const target = files[i + n]; if (i >= 0 && target) void navigate(target).catch(report); };
    prev.onclick = () => move(-1); next.onclick = () => move(1);
    save.onclick = () => { void (async () => {
      if (!dirty || busy) return; busy = true; refresh();
      try {
        const target = await platform.saveDialog({ defaultPath: path.replace(/\.[^.]+$/, "-edited.png"), filters: [{ name: "PNG", extensions: ["png"] }] });
        if (!target) return;
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG 변환 실패")), "image/png"));
        await platform.writeImageCopy(target, path, new Uint8Array(await blob.arrayBuffer()));
        dirty = false; refresh(); await platform.notice("편집 이미지를 저장했습니다.");
      } finally { busy = false; refresh(); }
    })().catch(report); };
    for (const file of files.slice(0, 1000)) {
      const b = button(""); b.title = nameOf(file); b.setAttribute("aria-label", nameOf(file));
      const thumb = document.createElement("img"); thumb.loading = "lazy"; thumb.src = platform.assetUrl(file); thumb.alt = ""; b.append(thumb);
      b.onclick = () => { void navigate(file).catch(report); }; thumbs.append(b);
    }
    registerUpdateGuard(() => dirty || busy, value => { approved = value; });
    await platform.onCloseRequested(confirmLeave);
    window.addEventListener("focus", () => {
      if (busy) return;
      busy = true; refresh();
      void (async () => {
        if (await platform.fileSize(path) > MAX_BYTES) throw new Error("변경된 이미지가 100 MiB를 초과합니다.");
        const disk = new Uint8Array(await platform.readFileRaw(path));
        if (!equalBytes(known, disk)) {
          if (dirty) status.textContent = "원본이 외부에서 변경됨 · 편집 내용 유지";
          else await load(path);
        }
      })().catch(() => { status.textContent = "원본을 다시 읽을 수 없습니다."; }).finally(() => { busy = false; refresh(); });
    });
    window.addEventListener("beforeunload", e => { if (!approved && dirty) e.preventDefault(); });
    window.addEventListener("unload", () => { resize.disconnect(); cancelAnimationFrame(resizeFrame); if (url) URL.revokeObjectURL(url); });
    await load(initial);
  },
};
export default viewer;
