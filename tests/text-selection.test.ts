// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { revealSelection } from "../src/text/selection";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});
test("a large search yields and removes its measurement node when cancelled",async()=>{
  const editor=document.createElement("textarea");editor.wrap="soft";editor.value="line\n".repeat(30000)+"needle";editor.scrollTop=77;document.body.append(editor);
  let resume:FrameRequestCallback=()=>{};
  vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{resume=fn;return 1;});
  let current=true;const searching=revealSelection(editor,editor.value.indexOf("needle"),6,()=>current);
  expect(document.body.childElementCount).toBe(2);current=false;resume(0);
  expect(await searching).toBe(false);expect(editor.scrollTop).toBe(77);expect(document.body.children.length).toBe(1);expect(document.body.firstElementChild).toBe(editor);
});
