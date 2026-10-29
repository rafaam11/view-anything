// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { initializeUpdateInput, lockUpdateInput, updateInputLocked } from "../src/update/guard";
let stop: () => void = () => {};
afterEach(()=>{stop();document.body.replaceChildren();});
test("update barrier blocks later window shortcuts and settings actions, then restores input",()=>{
  document.body.innerHTML='<main id="app"><button>save</button></main><dialog class="va-settings"></dialog><dialog class="va-update-dialog"><button>cancel</button></dialog>';
  stop=initializeUpdateInput();const save=vi.fn(),cancel=vi.fn();
  window.addEventListener("keydown",save,true);
  document.querySelector("#app button")!.addEventListener("click",save);
  document.querySelector(".va-update-dialog button")!.addEventListener("click",cancel);
  try {
    lockUpdateInput(true);expect(updateInputLocked()).toBe(true);
    expect(document.querySelector(".va-settings")!.hasAttribute("inert")).toBe(true);
    const key=new KeyboardEvent("keydown",{key:"s",ctrlKey:true,cancelable:true});window.dispatchEvent(key);
    (document.querySelector("#app button") as HTMLButtonElement).click();expect(save).not.toHaveBeenCalled();expect(key.defaultPrevented).toBe(true);
    const inside = new KeyboardEvent("keydown",{key:"s",ctrlKey:true,bubbles:true,cancelable:true});
    document.querySelector(".va-update-dialog button")!.dispatchEvent(inside);expect(inside.defaultPrevented).toBe(true);expect(save).not.toHaveBeenCalled();
    (document.querySelector(".va-update-dialog button") as HTMLButtonElement).click();expect(cancel).toHaveBeenCalledOnce();
    lockUpdateInput(false);window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",ctrlKey:true}));expect(save).toHaveBeenCalledOnce();
    expect(document.querySelector("#app")!.hasAttribute("inert")).toBe(false);expect(document.querySelector(".va-settings")!.hasAttribute("inert")).toBe(false);
  } finally {window.removeEventListener("keydown",save,true);}
});
test("unlocking preserves a pre-existing inert state",()=>{
  document.body.innerHTML='<main id="app" inert></main>';stop=initializeUpdateInput();
  lockUpdateInput(true);lockUpdateInput(true);lockUpdateInput(false);expect(document.querySelector("#app")!.hasAttribute("inert")).toBe(true);
});
