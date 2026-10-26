/** True when the resolved (not just selected) theme is dark. */
export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Renders `.mermaid` blocks under root. mermaid is imported only when such blocks exist. */
export async function renderMermaid(root: HTMLElement): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".mermaid"));
  if (nodes.length === 0) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark() ? "dark" : "default" });
  let n = 0;
  for (const el of nodes) {
    const src = (el.dataset.src ??= el.textContent ?? "");
    try {
      const { svg } = await mermaid.render(`va-mermaid-${Date.now()}-${n++}`, src);
      el.innerHTML = svg;
    } catch (e) {
      el.textContent = src;
      el.classList.add("mermaid-error");
      el.title = String(e);
    }
  }
}
