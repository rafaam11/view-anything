// Completed actions (saved, copied, exported) report themselves here instead of in a modal box or
// a status line that stays: one polite live region, bottom centre, gone after a short read.
import "./toast.css";

let element: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows `message` as text; a newer one replaces it. Default time: 2 s + 60 ms a character, at most 6 s. */
export function toast(message: string, options: { timeout?: number } = {}): void {
  if (!element?.isConnected) {
    element = document.createElement("div");
    element.className = "va-toast";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.hidden = true;
    document.body.append(element);
  }
  const t = element;
  t.textContent = message;
  t.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { t.hidden = true; }, options.timeout ?? Math.min(6000, 2000 + 60 * message.length));
}
