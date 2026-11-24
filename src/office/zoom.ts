import { iconButton } from "../ui/icons";

/**
 * Zoom controls for the Office viewers: −, the percentage, +, and fit. Ctrl+wheel over `area`,
 * Ctrl+= / Ctrl+- / Ctrl+0 do the same. `apply` lays the content out for the given scale; `fit`
 * returns the scale that fits the window, or null when the viewer has no fit (100% then).
 */
export type Zoom = { controls: HTMLElement[]; scale(): number; set(scale: number): void; fit(): void; refit(): void };

const MIN = 0.25, MAX = 4;

export function zoomControls(area: HTMLElement, apply: (scale: number) => void, fitScale: () => number | null = () => null): Zoom {
  const out = iconButton("축소", "minus", "Ctrl+-"), into = iconButton("확대", "plus", "Ctrl+="), fitButton = iconButton("화면에 맞춤", "fit", "Ctrl+0");
  const label = document.createElement("span"); label.className = "office-zoom";
  let scale = 1, fitted = true;
  const show = (value: number) => {
    scale = Math.min(MAX, Math.max(MIN, value));
    label.textContent = `${Math.round(scale * 100)}%`;
    out.disabled = scale <= MIN; into.disabled = scale >= MAX;
    apply(scale);
  };
  const zoom: Zoom = {
    controls: [out, label, into, fitButton],
    scale: () => scale,
    set(value) { fitted = false; show(value); },
    fit() { fitted = true; show(fitScale() ?? 1); },
    refit() { if (fitted) show(fitScale() ?? 1); },
  };
  out.onclick = () => zoom.set(scale / 1.25);
  into.onclick = () => zoom.set(scale * 1.25);
  fitButton.onclick = () => zoom.fit();
  area.addEventListener("wheel", e => {
    if (!e.ctrlKey || !e.deltaY) return;
    e.preventDefault();
    zoom.set(scale * Math.exp(-Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode === 1 ? 16 : 1))) * 0.002));
  }, { passive: false });
  window.addEventListener("keydown", e => {
    if (!e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (e.key === "=" || e.key === "+") { e.preventDefault(); into.click(); }
    else if (e.key === "-") { e.preventDefault(); out.click(); }
    else if (e.key === "0") { e.preventDefault(); fitButton.click(); }
  });
  return zoom;
}
