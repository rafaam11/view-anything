// Temporary stub; Task 4 replaces it with the real markdown viewer.
import { platform } from "../platform";
import type { Viewer } from "../registry";

const viewer: Viewer = {
  async mount(el, path) {
    const bytes = await platform.readFile(path);
    const pre = document.createElement("pre");
    pre.textContent = new TextDecoder("utf-8").decode(bytes);
    el.replaceChildren(pre);
  },
};
export default viewer;
