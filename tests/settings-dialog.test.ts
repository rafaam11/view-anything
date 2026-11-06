// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openSettings } from "../src/settings/dialog";
import { configureSettings, registerTextSettings, textSettings } from "../src/settings/document";
import { DEFAULTS, applyPreferences, preferences } from "../src/settings/preferences";

const field = (name:string) => [...document.querySelectorAll("fieldset")].find(f=>f.querySelector("legend")!.textContent===name)!;
const legends = () => [...document.querySelectorAll("legend")].map(l=>l.textContent);
const change = (control:HTMLInputElement|HTMLSelectElement,value:string) => {control.value=value;control.dispatchEvent(new Event("change"));};
const settle = async () => {for(let i=0;i<3;i++)await new Promise(r=>setTimeout(r,0));};
beforeEach(()=>{document.querySelector("dialog")?.close();document.body.replaceChildren();applyPreferences(DEFAULTS,false);configureSettings(null);});
afterEach(()=>{document.querySelector("dialog")?.close();vi.restoreAllMocks();});

test("images and other viewers show only general options; theme uses the existing preference",()=>{
  configureSettings("image.PNG");openSettings();expect(legends()).toEqual(["일반"]);
  change(field("일반").querySelector("select")!,"light");expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("va.theme")).toBe("light");expect(document.querySelector("input")).toBeNull();
});
test("Markdown display edits and reset preserve the separate text settings",()=>{
  applyPreferences({textFont:"serif",textSize:22,textWrap:false},false);configureSettings("a.markdown");openSettings();
  expect(legends()).toEqual(["일반","Markdown"]);
  change(field("Markdown").querySelector("select")!,"mono");change(field("Markdown").querySelector("input")!,"20");
  expect(preferences().mdSize).toBe(20);field("Markdown").querySelector("button")!.click();
  expect(preferences()).toEqual({...DEFAULTS,textFont:"serif",textSize:22,textWrap:false});
});
test("the body width is a Markdown option that the Markdown reset restores",()=>{
  configureSettings("a.md");openSettings();
  const width=field("Markdown").querySelector<HTMLSelectElement>('select[aria-label="본문 폭"]')!;
  expect(width.value).toBe("normal");change(width,"wide");expect(preferences().mdWidth).toBe("wide");
  field("Markdown").querySelector("button")!.click();expect(preferences().mdWidth).toBe("normal");expect(width.value).toBe("normal");
  document.querySelector("dialog")!.close();configureSettings("a.txt");openSettings();
  expect(document.querySelector('select[aria-label="본문 폭"]')).toBeNull();
});
test("empty windows offer both display groups but no file encoding",()=>{
  openSettings();expect(legends()).toEqual(["일반","Markdown","텍스트"]);
  applyPreferences({mdSize:22,textSize:24});field("텍스트").querySelector("button")!.click();
  expect(preferences()).toEqual({...DEFAULTS,mdSize:22});
});
test("explicit text mode has only text options and validates the font size",()=>{
  configureSettings("unknown.file",true);registerTextSettings({encoding:()=>"utf",changeEncoding:async()=>{}});openSettings();
  expect(legends()).toEqual(["일반","텍스트","현재 파일"]);
  change(field("텍스트").querySelector('input[type=number]')!,"13.5");expect(preferences().textSize).toBe(14);
  expect(document.querySelector("[role=status]")!.textContent).toContain("정수");
  change(field("텍스트").querySelector('input[type=number]')!,"24");expect(preferences().textSize).toBe(24);
  const wrap=field("텍스트").querySelector<HTMLInputElement>('input[type=checkbox]')!;wrap.checked=false;wrap.dispatchEvent(new Event("change"));expect(preferences().textWrap).toBe(false);
});
test("encoding cancellation/error restores the file selection and never persists it",async()=>{
  configureSettings("text.txt");const changeEncoding=vi.fn(async()=>{throw Error("read error");});
  registerTextSettings({encoding:()=>"utf",changeEncoding});openSettings();
  const encoding=field("현재 파일").querySelector("select")!;change(encoding,"cp949");expect(encoding.disabled).toBe(true);await settle();
  expect(encoding.disabled).toBe(false);expect(encoding.value).toBe("utf");expect(document.querySelector("[role=status]")!.textContent).toContain("read error");
  expect(JSON.stringify(preferences())).not.toContain("cp949");
  configureSettings("model.stl");expect(document.querySelector("dialog[open]")).toBeNull();expect(textSettings()).toBeNull();
  openSettings();expect(legends()).toEqual(["일반"]);
});
test("a data viewer that registers an encoding gets the file group without text display options",()=>{
  configureSettings("table.csv");registerTextSettings({encoding:()=>"utf",changeEncoding:async()=>{}});openSettings();
  expect(legends()).toEqual(["일반","현재 파일"]);
});
test("the text group toggles syntax highlighting and its reset turns it back on",()=>{
  configureSettings("a.py");openSettings();
  const box=[...field("텍스트").querySelectorAll("label")].find(l=>l.textContent?.includes("구문 강조"))!.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  expect(box.checked).toBe(true);box.checked=false;box.dispatchEvent(new Event("change"));expect(preferences().textHighlight).toBe(false);
  field("텍스트").querySelector("button")!.click();expect(preferences().textHighlight).toBe(true);
});
