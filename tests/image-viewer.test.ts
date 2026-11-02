// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ close: async () => true, copy:vi.fn(async () => {}), copyText:vi.fn(async () => {}), fullscreen:vi.fn(async () => {}), alert:vi.fn(async () => {}), save:vi.fn(async () => {}), notice:vi.fn(async () => {}), files:vi.fn(async () => ["a.png","b.jpg"]), read:vi.fn(async () => new ArrayBuffer(10)), discard:vi.fn(async () => false) }));
vi.mock("../src/platform", () => ({platform:{
  siblingImages:state.files, fileSize:async () => 10, readFileRaw:state.read, assetUrl:(p:string) => p,
  setWindowTitle:async (title:string) => {document.title=title;}, onCloseRequested:async (fn:()=>Promise<boolean>) => {state.close=fn;},
  copyImage:state.copy, copyText:state.copyText, setFullscreen:state.fullscreen, alert:state.alert, confirmDiscard:state.discard,
  saveDialog:async () => "copy.png", writeImageCopy:state.save, notice:state.notice,
}}));
vi.mock("../src/update/guard", () => ({registerUpdateGuard:()=>{}}));
import viewer from "../src/image/viewer";
const settle = async () => {for(let i=0;i<5;i++) await new Promise(r=>setTimeout(r,0));};
const button = (label:string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
beforeEach(async () => {
  vi.clearAllMocks(); state.files.mockResolvedValue(["a.png","b.jpg"]); state.read.mockResolvedValue(new ArrayBuffer(10)); vi.spyOn(window,"addEventListener");
  vi.stubGlobal("Image",class {naturalWidth=2000;naturalHeight=1000;src="";async decode(){}});
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({drawImage:vi.fn(),setTransform:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,"toBlob").mockImplementation(cb=>cb(new Blob([new Uint8Array([1,2,3])])));
  document.body.replaceChildren(); await viewer.mount(document.body,"a.png");
  const area=document.querySelector(".image-area")!;
  Object.defineProperties(area,{clientWidth:{value:800},clientHeight:{value:600}});
  button("화면에 맞춤").click();
});
afterEach(()=>{
  for(const [type,fn,opts] of vi.mocked(window.addEventListener).mock.calls)window.removeEventListener(type,fn,opts);
  vi.restoreAllMocks();vi.unstubAllGlobals();delete document.documentElement.dataset.fullscreen;
});
const inputs = () => [...document.querySelectorAll<HTMLInputElement>(".image-coords input")];
const values = () => inputs().map(i=>Number(i.value));
const coordsHidden = () => document.querySelector<HTMLElement>(".image-coords")!.hidden;
const applyCrop = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="자르기 적용")!;
const pointer = (type:string,clientX:number,clientY:number) => document.querySelector(".image-area")!.dispatchEvent(new MouseEvent(type,{clientX,clientY,button:0,bubbles:true,cancelable:true}));
/** Edit mode with the crop open; the 2000×1000 image shows at 1000×500 from the viewport origin. */
const openCrop = async () => {
  const area=document.querySelector<HTMLElement>(".image-area")!;area.setPointerCapture=()=>{};
  vi.spyOn(document.querySelector<HTMLImageElement>(".image-area img")!,"getBoundingClientRect").mockReturnValue({left:0,top:0,right:1000,bottom:500,width:1000,height:500} as DOMRect);
  button("이미지 편집").click();await settle();button("자르기").click();
  return area;
};
test("Ctrl Shift C copies only the file path and Ctrl C only the image",async()=>{
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"C",ctrlKey:true,shiftKey:true,cancelable:true}));await settle();
  expect(state.copyText).toHaveBeenCalledWith("a.png");expect(state.copy).not.toHaveBeenCalled();
  expect(document.querySelector("[role=status]")!.textContent).toContain("경로");
  state.copyText.mockClear();
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"c",ctrlKey:true}));await settle();
  expect(state.copy).toHaveBeenCalledTimes(1);expect(state.copyText).not.toHaveBeenCalled();
});
test("the file menu copies the path of the image currently shown",async()=>{
  button("다음 이미지").click();await settle();
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.includes("파일 경로 복사"))!.click();await settle();
  expect(state.copyText).toHaveBeenCalledWith("b.jpg");
});
test("a failed path copy reports the error without a success message",async()=>{
  state.copyText.mockRejectedValueOnce(Error("clipboard busy"));
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"c",ctrlKey:true,shiftKey:true}));await settle();
  expect(state.alert).toHaveBeenCalled();expect(document.querySelector("[role=status]")!.textContent).toBe("");
});
test("left rotation and vertical flip are edit-only and undoable",async()=>{
  expect(button("왼쪽으로 회전").hidden).toBe(true);expect(button("상하 반전").hidden).toBe(true);
  button("이미지 편집").click();await settle();
  button("왼쪽으로 회전").click();expect(document.querySelector("canvas")!.width).toBe(1000);expect(await state.close()).toBe(false);
  button("상하 반전").click();expect(document.querySelector("canvas")!.height).toBe(2000);
  button("실행 취소").click();button("실행 취소").click();expect(await state.close()).toBe(true);
});
test("the footer shows image facts and drops the file size while edited",async()=>{
  const info=document.querySelector(".image-info")!;
  expect(info.textContent).toBe("2000×1000 · PNG · 10 B");
  button("이미지 편집").click();await settle();button("오른쪽으로 회전").click();
  expect(info.textContent).toBe("1000×2000 · 편집 중");
  button("실행 취소").click();expect(info.textContent).toBe("2000×1000 · PNG · 10 B");
});
test("pixels turn sharp from 400 percent, except for SVG",async()=>{
  const frame=document.querySelector(".image-frame")!;
  for(let i=0;i<10;i++)button("확대").click();
  expect(frame.classList.contains("image-pixelated")).toBe(false);
  button("확대").click();expect(frame.classList.contains("image-pixelated")).toBe(true);
  button("화면에 맞춤").click();expect(frame.classList.contains("image-pixelated")).toBe(false);
  document.body.replaceChildren();await viewer.mount(document.body,"a.svg");
  const svg=document.querySelector(".image-frame")!;
  for(let i=0;i<12;i++)button("확대").click();
  expect(svg.classList.contains("image-pixelated")).toBe(false);
});
test("dragging on the image draws the crop in image pixels and applying uses it",async()=>{
  await openCrop();expect(values()).toEqual([0,0,2000,1000]);
  pointer("pointerdown",100,100);pointer("pointermove",300,200);pointer("pointerup",300,200);
  expect(values()).toEqual([200,200,400,200]);
  expect(document.querySelector<HTMLElement>(".image-crop-box")!.style.left).toBe("10%");
  applyCrop().click();
  expect(document.querySelector("canvas")!.width).toBe(400);expect(document.querySelector("canvas")!.height).toBe(200);
  expect(coordsHidden()).toBe(true);expect(document.querySelector<HTMLElement>(".image-crop")!.hidden).toBe(true);
});
test("a press that barely moves keeps the crop and a reversed drag still works",async()=>{
  await openCrop();
  pointer("pointerdown",100,100);pointer("pointermove",101,101);pointer("pointerup",101,101);
  expect(values()).toEqual([0,0,2000,1000]);
  pointer("pointerdown",300,200);pointer("pointermove",100,100);pointer("pointerup",100,100);
  expect(values()).toEqual([200,200,400,200]);
});
test("dragging inside the crop moves it and a handle resizes it",async()=>{
  await openCrop();
  pointer("pointerdown",100,100);pointer("pointermove",300,200);pointer("pointerup",300,200);
  pointer("pointerdown",200,150);pointer("pointermove",250,150);pointer("pointerup",250,150);
  expect(values()).toEqual([300,200,400,200]);
  pointer("pointerdown",350,200);pointer("pointermove",400,200);pointer("pointerup",400,200);
  expect(values()).toEqual([300,200,500,200]);
});
test("dragging outside the image pans instead of cropping, and only inside double-click is off",async()=>{
  const area=await openCrop();const zoom=document.querySelector(".image-zoom")!, before=zoom.textContent;
  area.scrollLeft=50;
  pointer("pointerdown",2000,2000);pointer("pointermove",1990,2000);pointer("pointerup",1990,2000);
  expect(area.scrollLeft).toBe(60);expect(values()).toEqual([0,0,2000,1000]);
  pointer("dblclick",100,100);expect(zoom.textContent).toBe(before);
  pointer("dblclick",2000,2000);expect(zoom.textContent).toBe("100%");
});
test("crop inputs clamp on change and the overlay follows them",async()=>{
  await openCrop();
  inputs()[0].value="500";inputs()[0].dispatchEvent(new Event("input"));
  expect(document.querySelector<HTMLElement>(".image-crop-box")!.style.left).toBe("25%");
  inputs()[2].value="99999";inputs()[2].dispatchEvent(new Event("change"));
  expect(values()).toEqual([500,0,1500,1000]);
});
test("a new crop starts from the size of the current edit",async()=>{
  await openCrop();button("자르기").click();button("오른쪽으로 회전").click();button("자르기").click();
  expect(values()).toEqual([0,0,1000,2000]);
});
test("Enter applies the crop from the inputs and the toggle, but not from other buttons",async()=>{
  await openCrop();
  inputs()[2].value="100";inputs()[2].dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
  expect(document.querySelector("canvas")!.width).toBe(100);
  button("자르기").click();
  inputs()[2].value="50";button("자르기").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
  expect(document.querySelector("canvas")!.width).toBe(50);
  button("자르기").click();inputs()[2].value="20";
  const other=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});button("상하 반전").dispatchEvent(other);
  expect(other.defaultPrevented).toBe(false);expect(document.querySelector("canvas")!.width).toBe(50);
});
test("Esc cancels the crop first, then leaves full screen",async()=>{
  document.documentElement.dataset.fullscreen="true";
  await openCrop();
  inputs()[0].dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));await settle();
  expect(coordsHidden()).toBe(true);expect(state.fullscreen).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",cancelable:true}));await settle();
  expect(state.fullscreen).toHaveBeenCalledWith(false);expect(document.documentElement.dataset.fullscreen).toBeUndefined();
});
test("Esc does nothing to the window outside full screen and leaves an open dialog alone",async()=>{
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",cancelable:true}));await settle();
  expect(state.fullscreen).not.toHaveBeenCalled();
  document.documentElement.dataset.fullscreen="true";
  const dialog=document.createElement("dialog");dialog.setAttribute("open","");document.body.append(dialog);
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",cancelable:true}));await settle();
  expect(state.fullscreen).not.toHaveBeenCalled();
});
test("clean default hides edit details and thumbnails",()=>{
  expect(document.querySelector<HTMLElement>(".image-coords")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>(".image-thumbs")!.hidden).toBe(true);
  expect(button("오른쪽으로 회전").hidden).toBe(true);expect(button("이미지 복사").title).toContain("Ctrl+C");
});
test("Ctrl wheel zooms only the image and plain wheel is left to scrolling",()=>{
  const area=document.querySelector(".image-area")!, image=document.querySelector<HTMLImageElement>(".image-area img")!;
  const width=parseFloat(image.style.width);
  const plain=new WheelEvent("wheel",{deltaY:-100,cancelable:true});area.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(false);expect(parseFloat(image.style.width)).toBe(width);
  const zoom=new WheelEvent("wheel",{deltaY:-100,cancelable:true});Object.defineProperty(zoom,"ctrlKey",{value:true});area.dispatchEvent(zoom);
  expect(zoom.defaultPrevented).toBe(true);expect(parseFloat(image.style.width)).toBeGreaterThan(width);
});
test("Ctrl C copies pixels without making the document dirty",async()=>{
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"c",ctrlKey:true}));await settle();
  expect(state.copy).toHaveBeenCalledWith(new Uint8Array([1,2,3]));expect(await state.close()).toBe(true);
});
test("edits require edit mode and dirty navigation is cancellable",async()=>{
  button("이미지 편집").click();await settle();button("오른쪽으로 회전").click();
  expect(await state.close()).toBe(false);button("이미지 편집").click();await settle();
  expect(button("이미지 편집").getAttribute("aria-pressed")).toBe("true");
  button("자르기").click();expect(document.querySelector<HTMLElement>(".image-coords")!.hidden).toBe(false);
});
test("clipboard errors keep edits and restore usable controls",async()=>{
  button("이미지 편집").click();await settle();button("오른쪽으로 회전").click();
  state.copy.mockRejectedValueOnce(Error("clipboard busy"));button("이미지 복사").click();await settle();
  expect(state.alert).toHaveBeenCalled();expect(button("이미지 복사").disabled).toBe(false);expect(await state.close()).toBe(false);
});
test("undo restores clean source; redo and branch edits preserve dirty protection",async()=>{
  button("이미지 편집").click(); await settle(); button("오른쪽으로 회전").click();
  expect(document.querySelector("canvas")!.width).toBe(1000);
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true}));
  expect(await state.close()).toBe(true); expect(button("실행 취소").disabled).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"Z",ctrlKey:true,shiftKey:true}));
  expect(await state.close()).toBe(false); expect(document.querySelector("canvas")!.width).toBe(1000);
  button("실행 취소").click(); button("좌우 반전").click();
  expect(button("다시 실행").disabled).toBe(true); expect(await state.close()).toBe(false);
});
test("successful copy save marks a checkpoint that undo/redo can revisit",async()=>{
  button("이미지 편집").click(); await settle(); button("오른쪽으로 회전").click();
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",ctrlKey:true})); await settle();
  expect(state.save).toHaveBeenCalled(); expect(await state.close()).toBe(true);
  button("실행 취소").click(); expect(await state.close()).toBe(false);
  button("다시 실행").click(); expect(await state.close()).toBe(true);
});
test("failed save and invalid crop keep the current image and history",async()=>{
  button("이미지 편집").click(); await settle(); button("오른쪽으로 회전").click();
  const current=document.querySelector("canvas");
  button("자르기").click(); const inputs=document.querySelectorAll<HTMLInputElement>(".image-coords input"); inputs[2].value="99999";
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="자르기 적용")!.click(); await settle();
  expect(document.querySelector("canvas")).toBe(current); expect(state.alert).toHaveBeenCalled();
  state.save.mockRejectedValueOnce(Error("disk full"));
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",ctrlKey:true})); await settle();
  expect(await state.close()).toBe(false); button("실행 취소").click(); expect(await state.close()).toBe(true);
});
test("focus refreshes added/deleted siblings while preserving dirty image history",async()=>{
  button("이미지 편집").click(); await settle(); button("오른쪽으로 회전").click();
  state.files.mockResolvedValue(["00.png","c.jpg"]); state.read.mockRejectedValueOnce(Error("source deleted"));
  window.dispatchEvent(new Event("focus")); await settle();
  expect(button("이전 이미지").disabled).toBe(false); expect(button("다음 이미지").disabled).toBe(false);
  expect(document.querySelector("canvas")!.width).toBe(1000); expect(await state.close()).toBe(false);
  expect(document.querySelector("[role=status]")!.textContent).toContain("유지");
  button("실행 취소").click(); expect(await state.close()).toBe(true);
  button("다음 이미지").click(); await settle(); expect(document.title).toBe("c.jpg"); expect(button("다시 실행").disabled).toBe(true);
});
test("F5 rebuilds visible thumbnails, including cache refresh and current image marker",async()=>{
  const show = [...document.querySelectorAll<HTMLElement>(".va3d-menu-item")].find(b=>b.textContent?.includes("썸네일"))!;
  show.click(); const old = document.querySelector<HTMLImageElement>(".image-thumbs img")!.src;
  state.files.mockResolvedValue(["a.png","new.jpg"]);
  const key=new KeyboardEvent("keydown",{key:"F5",cancelable:true}); window.dispatchEvent(key); await settle();
  expect(key.defaultPrevented).toBe(true); expect(button("new.jpg")).not.toBeNull();
  expect(document.querySelector<HTMLImageElement>(".image-thumbs img")!.src).not.toBe(old);
  expect(button("a.png").getAttribute("aria-current")).toBe("true"); expect(document.title).toBe("a.png");
});
test("folder and decode failures retain the previous list, image and unsaved edits",async()=>{
  button("이미지 편집").click(); await settle(); button("오른쪽으로 회전").click();
  const current=document.querySelector("canvas");
  state.files.mockRejectedValueOnce(Error("folder denied"));
  window.dispatchEvent(new Event("focus")); await settle();
  expect(document.querySelector("[role=status]")!.textContent).toContain("이전 목록");
  expect(button("다음 이미지").disabled).toBe(false);
  state.discard.mockResolvedValueOnce(true); vi.spyOn(Image.prototype,"decode").mockRejectedValueOnce(Error("bad PNG"));
  button("다음 이미지").click(); await settle();
  expect(document.title).toContain("a.png"); expect(document.querySelector("canvas")).toBe(current);
  expect(state.alert).toHaveBeenCalled(); expect(await state.close()).toBe(false);
  button("실행 취소").click(); expect(await state.close()).toBe(true);
});
test("a denied directory does not prevent the initial image from opening",async()=>{
  state.files.mockRejectedValueOnce(Error("folder denied")); await viewer.mount(document.body,"a.png");
  expect(document.querySelector<HTMLImageElement>(".image-area img")!.hidden).toBe(false);
  expect(document.querySelector("[role=status]")!.textContent).toContain("현재 이미지");
  expect(button("이미지 복사").disabled).toBe(false);
});
