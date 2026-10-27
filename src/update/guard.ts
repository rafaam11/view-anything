// Small editor bridge; no updater plugin in the Markdown or app entry chunks.
let inspect = (): boolean => false;
let allowUnload = (_value: boolean): void => {};
export function registerUpdateGuard(dirty: () => boolean, approved: (value: boolean) => void): void {
  inspect = dirty;
  allowUnload = approved;
}
export function updateDirty(): boolean { return inspect(); }
export function approveUpdateUnload(value: boolean): void { allowUnload(value); }
