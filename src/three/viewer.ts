import type { Viewer } from "../registry";

// Placeholder until the real 3D viewer lands. Must not import three.js yet.
const viewer: Viewer = {
  async mount(el: HTMLElement, _path: string): Promise<void> {
    const box = document.createElement("div");
    box.className = "empty";
    const p = document.createElement("p");
    p.textContent = "3D 뷰어 준비 중";
    box.append(p);
    el.replaceChildren(box);
  },
};

export default viewer;
