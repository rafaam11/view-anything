import "./viewer.css";
import { platform } from "../platform";
import { registerUpdateGuard } from "../update/guard";
import type { Viewer } from "../registry";
import { equalBytes } from "../data/document";
import { documentBar } from "../ui/chrome";
import { iconButton } from "../ui/icons";
import { ImageHistory, transformImage, type ImageState } from "./history";

const MAX_BYTES = 100 * 1024 * 1024, MAX_PIXELS = 50_000_000;
const nameOf = (p: string) => p.split(/[\\/]/).pop() ?? p;
const pathKey = (p: string) => { const normalized = p.replace(/\\/g, "/"); return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized; };
const button = (text: string) => { const b = document.createElement("button"); b.textContent = text; return b; };

const viewer: Viewer = {
  async mount(el, initial) {
    let path = initial, files: string[] = [], available: string[] = [], url = "", dirty = false, edited = false, approved = false, busy = true, scale = 1, editing = false, fitted = true;
    let original: HTMLImageElement | null = null, known = new Uint8Array();
    let history: ImageHistory | null = null;
    const root = document.createElement("div"); root.className = "image-root va-viewer";
    const bar = document.createElement("header"); bar.className = "image-bar";
    const title = document.createElement("strong");
    const status = document.createElement("span"); status.setAttribute("role", "status");
    const prev = iconButton("이전 이미지", "previous", "ArrowLeft"), next = iconButton("다음 이미지", "next", "ArrowRight");
    const zoomOut = iconButton("축소", "minus"), zoomIn = iconButton("확대", "plus"), fit = iconButton("화면에 맞춤", "fit", "Ctrl+0");
    const rotate = iconButton("회전", "rotate"), flip = iconButton("좌우 반전", "flip"), cropToggle = iconButton("자르기", "crop");
    const copy = iconButton("이미지 복사", "copy", "Ctrl+C"), toggle = iconButton("이미지 편집", "edit"), save = button("PNG로 저장"), crop = button("자르기 적용");
    const undo = iconButton("실행 취소", "undo", "Ctrl+Z"), redo = iconButton("다시 실행", "redo", "Ctrl+Y");
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
    let canvas = document.createElement("canvas"); canvas.hidden = true;
    const surface = document.createElement("div"); surface.className = "image-surface"; surface.append(image, canvas); area.append(surface);
    const thumbs = document.createElement("nav"); thumbs.className = "image-thumbs"; thumbs.setAttribute("aria-label", "같은 폴더 이미지");
    thumbs.hidden = true; status.className = "va-status";
    const actual = button("원본 크기 (100%)"); actual.onclick = () => setZoom(1);
    documentBar(bar, { files:[save], controls:[prev, next, zoomOut, zoomLabel, zoomIn, fit, copy, undo, redo, rotate, flip, cropToggle, toggle], view:[
      { label:"화면에 맞춤", run:() => fit.click() }, { label:"원본 크기 (100%)", run:() => actual.click() },
      { label:"썸네일", checked:() => !thumbs.hidden, run:() => { thumbs.hidden = !thumbs.hidden; renderThumbs(); applyScale(); } },
      { label:"목록 새로고침", shortcut:"F5", run:() => { void refreshSources(true); }, disabled:() => busy },
    ] });
    root.append(bar, coords, area, thumbs, status); el.replaceChildren(root);
    const report = (e: unknown) => { void platform.alert(String(e)).catch(() => {}); };
    const refresh = () => {
      title.textContent = (dirty ? "● " : "") + nameOf(path); void platform.setWindowTitle(title.textContent).catch(() => {});
      const index = files.findIndex(f => pathKey(f) === pathKey(path)); prev.disabled = busy || index <= 0; next.disabled = busy || index < 0 || index + 1 >= files.length;
      undo.hidden = redo.hidden = rotate.hidden = flip.hidden = cropToggle.hidden = save.hidden = !editing;
      for (const b of [copy, rotate, flip, cropToggle, toggle]) b.disabled = busy;
      undo.disabled = busy || !history?.previous; redo.disabled = busy || !history?.next;
      save.disabled = busy || !dirty;
      toggle.setAttribute("aria-pressed", String(editing));
      for (const b of thumbs.querySelectorAll<HTMLButtonElement>("button")) {
        b.disabled = busy; b.setAttribute("aria-current", String(pathKey(b.dataset.path!) === pathKey(path)));
      }
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
    const confirmLeave = async () => !busy && (approved || !dirty || await platform.confirmDiscard("저장하지 않은 이미지 편집을 버릴까요?"));
    const discard = async () => approved || !dirty || await platform.confirmDiscard("저장하지 않은 이미지 편집을 버릴까요?");
    const load = async (target: string) => {
      if (await platform.fileSize(target) > MAX_BYTES) throw new Error("이미지가 100 MiB를 초과합니다.");
      const bytes = await platform.readFileRaw(target);
      if (bytes.byteLength > MAX_BYTES) throw new Error("이미지가 100 MiB를 초과합니다.");
      const ext = target.split(".").pop()?.toLowerCase();
      const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      const nextUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const candidate = new Image(); candidate.src = nextUrl;
      try { await candidate.decode(); } catch (e) { URL.revokeObjectURL(nextUrl); throw e; }
      if (candidate.naturalWidth * candidate.naturalHeight > MAX_PIXELS) { URL.revokeObjectURL(nextUrl); throw new Error("이미지가 5천만 픽셀을 초과합니다."); }
      if (url) URL.revokeObjectURL(url);
      path = target; url = nextUrl; original = candidate; known = new Uint8Array(bytes); image.src = url; dirty = false; edited = false; scale = 1; status.textContent = "";
      history = new ImageHistory(candidate.naturalWidth, candidate.naturalHeight); canvas.width = canvas.height = 0;
      fitted = true; coords.hidden = true; editing = false;
      canvas.hidden = true; image.hidden = false; inputs[0].value = "0"; inputs[1].value = "0";
      inputs[2].value = String(candidate.naturalWidth); inputs[3].value = String(candidate.naturalHeight);
      syncNavigation(); refresh(); applyScale();
    };
    const navigate = async (target: string) => {
      if (busy || pathKey(target) === pathKey(path)) return; busy = true;
      refresh(); try { if (await discard()) await load(target); } finally { busy = false; refresh(); }
    };
    const renderState = (state: ImageState) => {
      const tmp = document.createElement("canvas"); tmp.width = state.width; tmp.height = state.height;
      const ctx = tmp.getContext("2d"); if (!ctx) throw new Error("이미지 편집 화면을 만들 수 없습니다.");
      ctx.setTransform(...state.matrix); ctx.drawImage(original!, 0, 0);
      surface.replaceChild(tmp, canvas); canvas.width = canvas.height = 0; canvas = tmp;
    };
    const showState = () => {
      dirty = history!.dirty; edited = !history!.original;
      image.hidden = edited; canvas.hidden = !edited; coords.hidden = true; status.textContent = "";
      inputs[0].value = inputs[1].value = "0"; inputs[2].value = String(history!.state.width); inputs[3].value = String(history!.state.height);
      refresh(); applyScale();
    };
    const draw = (transform: "rotate" | "flip" | "crop") => {
      if (!original || !history || busy || !editing) return;
      const [x, y, width, height] = inputs.map(i => Number(i.value));
      const state = transformImage(history.state, transform === "crop" ? { kind: "crop", x, y, width, height } : { kind: transform });
      renderState(state); history.commit(state); showState();
    };
    const stepHistory = (back: boolean) => {
      if (!history || !editing || busy) return;
      const state = back ? history.previous : history.next; if (!state) return;
      try { renderState(state); if (back) history.undo(); else history.redo(); showState(); } catch (e) { report(e); }
    };
    undo.onclick = () => stepHistory(true); redo.onclick = () => stepHistory(false);
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
        if (editing && dirty) { if (!await discard()) return; await load(path); }
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
      if (e.key === "F5") { e.preventDefault(); if (!document.querySelector("dialog[open]") && !e.repeat) void refreshSources(true); return; }
      if (document.querySelector("dialog[open]") || (e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable=true]")) return;
      if (e.ctrlKey && e.key.toLowerCase() === "c") { e.preventDefault(); if (!e.repeat) copy.click(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo.click(); else undo.click(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); redo.click(); }
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
        history!.markSaved(); dirty = false; refresh(); await platform.notice("편집 이미지를 저장했습니다.");
        await refreshFolder().catch(() => { status.textContent = "이미지는 저장했지만 폴더 목록을 갱신할 수 없습니다."; });
      } finally { busy = false; refresh(); }
    })().catch(report); };
    const syncNavigation = () => {
      files = available.slice();
      // Keep a virtual position for a deleted source so either neighbor is still reachable.
      if (!files.some(f => pathKey(f) === pathKey(path))) {
        const key = pathKey(path).toLowerCase();
        const i = files.findIndex(f => pathKey(f).toLowerCase() > key);
        files.splice(i < 0 ? files.length : i, 0, path);
      }
    };
    let thumbRevision = 0;
    const renderThumbs = () => {
      thumbs.replaceChildren();
      if (thumbs.hidden) return;
      for (const file of available.slice(0, 1000)) {
        const b = button(""); b.title = nameOf(file); b.setAttribute("aria-label", nameOf(file)); b.dataset.path = file;
        const thumb = document.createElement("img"); thumb.loading = "lazy";
        const asset = platform.assetUrl(file); thumb.src = `${asset}${asset.includes("?") ? "&" : "?"}va-refresh=${thumbRevision}`; thumb.alt = ""; b.append(thumb);
        b.onclick = () => { void navigate(file).catch(report); }; thumbs.append(b);
      }
      refresh();
    };
    const refreshFolder = async () => {
      available = await platform.siblingImages(path); syncNavigation(); thumbRevision++; renderThumbs(); refresh();
    };
    const refreshSources = async (manual = false) => {
      if (busy) return; busy = true; refresh();
      const notes: string[] = [];
      try {
        try { await refreshFolder(); } catch { notes.push("폴더 목록을 갱신할 수 없습니다. 이전 목록을 유지합니다."); }
        try {
          if (await platform.fileSize(path) > MAX_BYTES) throw new Error("변경된 이미지가 100 MiB를 초과합니다.");
          const disk = new Uint8Array(await platform.readFileRaw(path));
          if (disk.byteLength > MAX_BYTES) throw new Error("변경된 이미지가 100 MiB를 초과합니다.");
          if (!equalBytes(known, disk)) {
            if (dirty) notes.push("원본이 외부에서 변경됨 · 편집 내용 유지");
            else await load(path);
          }
        } catch { notes.push("원본을 다시 읽을 수 없습니다. 표시 중인 이미지와 편집 내용은 유지합니다."); }
        status.textContent = notes.join(" · ") || (manual ? "이미지 목록을 갱신했습니다." : "");
      } finally { busy = false; refresh(); }
    };
    registerUpdateGuard(() => dirty || busy, value => { approved = value; });
    await platform.onCloseRequested(confirmLeave);
    window.addEventListener("focus", () => { void refreshSources(); });
    window.addEventListener("beforeunload", e => { if (!approved && (dirty || busy)) e.preventDefault(); });
    window.addEventListener("unload", () => { resize.disconnect(); cancelAnimationFrame(resizeFrame); if (url) URL.revokeObjectURL(url); });
    try {
      await load(initial);
      await refreshFolder().catch(() => { status.textContent = "폴더 목록을 읽을 수 없습니다. 현재 이미지는 열었습니다."; });
    } finally { busy = false; refresh(); }
  },
};
export default viewer;
