// Small editor bridge; no updater plugin in the Markdown or app entry chunks.
let inspect = (): boolean => false;
let allowUnload = (_value: boolean): void => {};
let locked = false;
const inert = new Map<HTMLElement, boolean>();
export const updateInputLocked = () => locked;
export function lockUpdateInput(value: boolean): void {
  locked = value;
  if (value) {
    for (const el of document.querySelectorAll<HTMLElement>("#app, .va-settings")) {
      if (!inert.has(el)) inert.set(el, el.hasAttribute("inert"));
      el.setAttribute("inert", "");
    }
  } else {
    for (const [el, wasInert] of inert) if (!wasInert) el.removeAttribute("inert");
    inert.clear();
  }
}
/** Install before titlebar/viewer shortcuts. Window capture precedes document capture. */
export function initializeUpdateInput(): () => void {
  const block = (event: Event) => {
    const dialog = (event.target as Element | null)?.closest?.(".va-update-dialog");
    const key = event as KeyboardEvent;
    const dialogKey = ["Tab", "Enter", " ", "Escape"].includes(key.key) && !key.ctrlKey && !key.altKey && !key.metaKey;
    if (locked && (!dialog || (event.type === "keydown" && !dialogKey))) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const events = ["keydown", "click", "pointerdown", "mousedown", "contextmenu"];
  for (const type of events) window.addEventListener(type, block, true);
  return () => { for (const type of events) window.removeEventListener(type, block, true); lockUpdateInput(false); };
}
export function registerUpdateGuard(dirty: () => boolean, approved: (value: boolean) => void): void {
  inspect = dirty;
  allowUnload = approved;
}
export function updateDirty(): boolean { return inspect(); }
export function approveUpdateUnload(value: boolean): void { allowUnload(value); }
