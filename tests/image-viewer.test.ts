// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ close: async () => true, copy:vi.fn(async () => {}), alert:vi.fn(async () => {}), save:vi.fn(async () => {}), notice:vi.fn(async () => {}), files:vi.fn(async () => ["a.png","b.jpg"]), read:vi.fn(async () => new ArrayBuffer(10)), discard:vi.fn(async () => false) }));
vi.mock("../src/platform", () => ({platform:{
  siblingImages:state.files, fileSize:async () => 10, readFileRaw:state.read, assetUrl:(p:string) => p,
  setWindowTitle:async (title:string) => {document.title=title;}, onCloseRequested:async (fn:()=>Promise<boolean>) => {state.close=fn;},
  copyImage:state.copy, alert:state.alert, confirmDiscard:state.discard,
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
  vi.restoreAllMocks();vi.unstubAllGlobals();
});
test("clean default hides edit details and thumbnails",()=>{
  expect(document.querySelector<HTMLElement>(".image-coords")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>(".image-thumbs")!.hidden).toBe(true);
  expect(button("회전").hidden).toBe(true);expect(button("이미지 복사").title).toContain("Ctrl+C");
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
  button("이미지 편집").click();await settle();button("회전").click();
  expect(await state.close()).toBe(false);button("이미지 편집").click();await settle();
  expect(button("이미지 편집").getAttribute("aria-pressed")).toBe("true");
  button("자르기").click();expect(document.querySelector<HTMLElement>(".image-coords")!.hidden).toBe(false);
});
test("clipboard errors keep edits and restore usable controls",async()=>{
  button("이미지 편집").click();await settle();button("회전").click();
  state.copy.mockRejectedValueOnce(Error("clipboard busy"));button("이미지 복사").click();await settle();
  expect(state.alert).toHaveBeenCalled();expect(button("이미지 복사").disabled).toBe(false);expect(await state.close()).toBe(false);
});
test("undo restores clean source; redo and branch edits preserve dirty protection",async()=>{
  button("이미지 편집").click(); await settle(); button("회전").click();
  expect(document.querySelector("canvas")!.width).toBe(1000);
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true}));
  expect(await state.close()).toBe(true); expect(button("실행 취소").disabled).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"Z",ctrlKey:true,shiftKey:true}));
  expect(await state.close()).toBe(false); expect(document.querySelector("canvas")!.width).toBe(1000);
  button("실행 취소").click(); button("좌우 반전").click();
  expect(button("다시 실행").disabled).toBe(true); expect(await state.close()).toBe(false);
});
test("successful copy save marks a checkpoint that undo/redo can revisit",async()=>{
  button("이미지 편집").click(); await settle(); button("회전").click();
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",ctrlKey:true})); await settle();
  expect(state.save).toHaveBeenCalled(); expect(await state.close()).toBe(true);
  button("실행 취소").click(); expect(await state.close()).toBe(false);
  button("다시 실행").click(); expect(await state.close()).toBe(true);
});
test("failed save and invalid crop keep the current image and history",async()=>{
  button("이미지 편집").click(); await settle(); button("회전").click();
  const current=document.querySelector("canvas");
  button("자르기").click(); const inputs=document.querySelectorAll<HTMLInputElement>(".image-coords input"); inputs[2].value="99999";
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="자르기 적용")!.click(); await settle();
  expect(document.querySelector("canvas")).toBe(current); expect(state.alert).toHaveBeenCalled();
  state.save.mockRejectedValueOnce(Error("disk full"));
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",ctrlKey:true})); await settle();
  expect(await state.close()).toBe(false); button("실행 취소").click(); expect(await state.close()).toBe(true);
});
test("focus refreshes added/deleted siblings while preserving dirty image history",async()=>{
  button("이미지 편집").click(); await settle(); button("회전").click();
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
  button("이미지 편집").click(); await settle(); button("회전").click();
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
