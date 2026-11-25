import { iconButton, textButton } from "../ui/icons";

/**
 * The Office viewers' status bar, laid out as in Office: information on the left, zoom on the right
 * (−, slider, +, the percentage, fit). The slider is linear on each side of its centre, which is
 * 100%: 10% at the left end, 400% at the right. Ctrl+wheel over `area` and Ctrl+= / Ctrl+- / Ctrl+0
 * do the same. `apply` lays the content out for a scale; `fitScale` is the scale that fits the
 * window, or null when there is nothing to fit yet (100% then).
 */
export type Zoom = { scale(): number; set(scale: number): void; fit(): void; refit(): void };
export type StatusBar = { element: HTMLElement; zoom: Zoom; info(parts: string[]): void };

const MIN = 0.1, MAX = 4;

export function sliderToScale(position: number): number {
  return position <= 50 ? MIN + (position / 50) * (1 - MIN) : 1 + ((position - 50) / 50) * (MAX - 1);
}
export function scaleToSlider(scale: number): number {
  return scale <= 1 ? ((scale - MIN) / (1 - MIN)) * 50 : 50 + ((scale - 1) / (MAX - 1)) * 50;
}

export function officeStatusBar(area: HTMLElement, apply: (scale: number) => void, fitScale: () => number | null = () => null): StatusBar {
  const element = document.createElement("footer"); element.className = "office-statusbar";
  const info = document.createElement("span"); info.className = "office-status-info"; info.setAttribute("role", "status");
  const out = iconButton("축소", "minus", "Ctrl+-"), into = iconButton("확대", "plus", "Ctrl+=");
  const slider = document.createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "any";
  slider.className = "office-zoom-slider"; slider.setAttribute("aria-label", "확대/축소");
  const percent = textButton("100%", "ghost", { title: "100%로 보기" }); percent.classList.add("office-zoom");
  const fitButton = iconButton("창에 맞춤", "fit", "Ctrl+0");
  const zoomGroup = document.createElement("div"); zoomGroup.className = "office-zoom-group";
  zoomGroup.append(out, slider, into, percent, fitButton);
  element.append(info, zoomGroup);
  let scale = 1, fitted = true;
  const show = (value: number) => {
    scale = Math.min(MAX, Math.max(MIN, value));
    percent.textContent = `${Math.round(scale * 100)}%`;
    slider.value = String(scaleToSlider(scale));
    slider.setAttribute("aria-valuetext", percent.textContent);
    out.disabled = scale <= MIN; into.disabled = scale >= MAX;
    apply(scale);
  };
  const zoom: Zoom = {
    scale: () => scale,
    set(value) { fitted = false; show(value); },
    fit() { fitted = true; show(fitScale() ?? 1); },
    refit() { if (fitted) show(fitScale() ?? 1); },
  };
  out.onclick = () => zoom.set(scale / 1.25);
  into.onclick = () => zoom.set(scale * 1.25);
  percent.onclick = () => zoom.set(1);
  fitButton.onclick = () => zoom.fit();
  // Snaps to 100% near the centre, as Office's slider does.
  slider.oninput = () => { const v = Number(slider.value); zoom.set(Math.abs(v - 50) < 1.5 ? 1 : sliderToScale(v)); };
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
  return {
    element, zoom,
    info(parts) { info.textContent = parts.filter(Boolean).join("   "); },
  };
}
