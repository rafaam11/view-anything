/** True when the resolved (not just selected) theme is dark. */
export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

let token = 0;

/**
 * Renders `.mermaid` blocks under root. mermaid is imported only when such blocks exist.
 * A newer call supersedes an older one: the stale call stops without touching the DOM.
 */
export async function renderMermaid(root: HTMLElement): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".mermaid"));
  if (nodes.length === 0) return;
  const mine = ++token;
  const { default: mermaid } = await import("mermaid");
  if (mine !== token) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark() ? "dark" : "default" });
  let n = 0;
  for (const el of nodes) {
    const src = (el.dataset.src ??= el.textContent ?? "");
    const id = `va-mermaid-${mine}-${n++}`;
    try {
      const { svg } = await mermaid.render(id, src);
      if (mine !== token) return;
      el.classList.remove("mermaid-error");
      el.removeAttribute("title");
      el.innerHTML = svg;
    } catch (e) {
      // mermaid leaves its temporary container (#d<id>) in <body> when rendering fails.
      document.getElementById("d" + id)?.remove();
      if (mine !== token) return;
      el.textContent = src;
      el.classList.add("mermaid-error");
      el.title = String(e);
    }
  }
}

/** Calls cb when the effective theme may have changed (data-theme attribute or OS scheme). */
export function watchTheme(cb: () => void): void {
  new MutationObserver(cb).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (document.documentElement.dataset.theme === "system") cb();
  });
}
