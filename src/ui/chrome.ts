import "./chrome.css";
import { Menubar, type MenuItem } from "../three/core/menubar";
import { fileMenu } from "./file-menu";

/**
 * The document viewers' toolbar: 파일 (the shared list, then this viewer's commands) and 보기 on
 * the left, controls and the 편집 toggle on the right. `files` are buttons the viewer shows or
 * hides itself; `actions` are plain menu commands.
 */
export function documentBar(bar: HTMLElement, options: { toggle?: HTMLButtonElement; files?: HTMLButtonElement[]; actions?: MenuItem[]; view?: MenuItem[]; controls?: HTMLElement[] } = {}): Menubar {
  bar.classList.add("va-viewer-toolbar");
  const files = document.createElement("div");
  for (const b of options.files ?? []) { b.classList.add("va3d-menu-item"); files.append(b); }
  const actions: MenuItem[] = [...(options.files?.length ? [{ element: files, label: "파일 작업" }] : []), ...(options.actions ?? [])];
  const menus = new Menubar([
    { label: "파일", accessKey: "f", items: fileMenu(() => menus.close(), { actions }) },
    ...(options.view?.length ? [{ label: "보기", accessKey: "v", items: options.view }] : []),
  ]);
  const controls = document.createElement("div"); controls.className = "va-viewer-controls";
  controls.append(...(options.controls ?? []), ...(options.toggle ? [options.toggle] : []));
  bar.replaceChildren(menus.root, controls);
  window.addEventListener("keydown", e => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") menus.close();
    else menus.handleKey(e);
  });
  return menus;
}
