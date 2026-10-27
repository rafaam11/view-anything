// Toolbar and 보기 menu shared by the app viewer and the exported-HTML runtime: standard views and
// fit (mirroring the toolbar), the scene panel toggle, and the display mode / section controls.
import { TOOLBAR, type KeyAction } from "./keys";
import type { MenuItem } from "./menubar";

export interface ViewMenuContext {
  run(action: KeyAction): void;
  panelShown(): boolean;
  setPanelShown(shown: boolean): void;
  /** ViewTools.controls. */
  controls: HTMLElement;
}

/** "전체 맞춤 (F)" -> ["전체 맞춤", "F"]. */
function splitTip(tip: string): [string, string] {
  const m = /^(.*) \((.+)\)$/.exec(tip);
  return m ? [m[1], m[2]] : [tip, ""];
}

export function viewMenuItems(ctx: ViewMenuContext): MenuItem[] {
  const views: MenuItem[] = TOOLBAR.map(([action, , tip]) => {
    const [label, shortcut] = splitTip(tip);
    return { label, shortcut, run: () => ctx.run(action) };
  });
  return [
    ...views,
    { separator: true },
    { label: "장면 패널 표시", checked: () => ctx.panelShown(), run: () => ctx.setPanelShown(!ctx.panelShown()) },
    { separator: true },
    { element: ctx.controls },
  ];
}

/** Top-right toolbar: fit and the standard views. */
export function buildToolbar(run: (action: KeyAction) => void): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "va3d-toolbar";
  toolbar.setAttribute("role", "toolbar");
  for (const [action, label, tip] of TOOLBAR) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = tip;
    b.addEventListener("click", () => run(action));
    toolbar.append(b);
  }
  return toolbar;
}
