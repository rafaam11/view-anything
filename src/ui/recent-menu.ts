import type { MenuBlock } from "../three/core/menubar";
import { clearRecent, onRecentChange, recentFiles } from "../recent";

/** Opening goes through main.ts, which routes it like a drop or Ctrl+O. */
export const OPEN_PATH_EVENT = "va:open-path";
export interface OpenPathDetail { path: string }
const SHOWN = 10;

/**
 * The recent-files list as one element that keeps itself current. File names go in as text, the
 * full path only as the tooltip. `after` runs once a button was pressed (a menu closes itself).
 */
export function recentList(after: () => void = () => {}): HTMLElement {
  const root = document.createElement("div");
  root.className = "va-recent";
  const draw = () => {
    const paths = recentFiles().slice(0, SHOWN);
    if (!paths.length) {
      const none = document.createElement("p");
      none.className = "va-recent-none";
      none.textContent = "최근 파일 없음";
      root.replaceChildren(none);
      return;
    }
    const buttons = paths.map((path) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "va3d-menu-item";
      b.textContent = path.split(/[\\/]/).pop() || path;
      b.title = path;
      b.onclick = () => {
        after();
        window.dispatchEvent(new CustomEvent<OpenPathDetail>(OPEN_PATH_EVENT, { detail: { path } }));
      };
      return b;
    });
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "va3d-menu-item va-recent-clear";
    clear.textContent = "목록 지우기";
    clear.onclick = () => { clearRecent(); };
    root.replaceChildren(...buttons, clear);
  };
  draw();
  onRecentChange(draw);
  return root;
}

/** The same list as a file-menu section. */
export function recentMenuBlock(close: () => void): MenuBlock {
  return { element: recentList(close), label: "최근 파일" };
}
