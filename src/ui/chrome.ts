import "./chrome.css";
import { Menubar, type MenuItem } from "../three/core/menubar";

/** Reuse each viewer's existing commands and guards; the shell only changes their placement. */
export function documentBar(bar: HTMLElement, options: { toggle?: HTMLButtonElement; files?: HTMLButtonElement[]; view?: MenuItem[]; tools?: MenuItem[]; controls?: HTMLElement[] } = {}): Menubar {
  bar.classList.add("va-viewer-toolbar");
  const files = document.createElement("div");
  for (const b of options.files ?? []) { b.classList.add("va3d-menu-item"); files.append(b); }
  const menus = new Menubar([
    { label: "파일", accessKey: "f", items: [
      { label: "열기…", shortcut: "Ctrl+O", run: () => window.dispatchEvent(new CustomEvent("va:open")) },
      { label: "텍스트로 열기…", shortcut: "Ctrl+Shift+O", run: () => window.dispatchEvent(new CustomEvent("va:open", { detail: { text: true } })) },
      ...(options.files?.length ? [{ separator: true } as const, { element: files, label: "파일 작업" }] : []),
    ] },
    ...(options.view?.length ? [{ label: "보기", accessKey: "v", items: options.view }] : []),
    ...(options.tools?.length ? [{ label: "도구", accessKey: "e", items: options.tools }] : []),
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

export function command(button: HTMLButtonElement): MenuItem {
  return { label: button.textContent ?? "", run: () => button.click(), disabled: () => button.disabled };
}
