// The find bar Markdown, PDF and text share: a floating box over the content (opening it moves
// nothing), a live count, and icon buttons. Each viewer keeps its own search; this only handles
// the keys: Enter next, Shift+Enter previous, Esc close, and no search on the Enter that commits
// an IME syllable.
import { iconButton } from "./icons";

export interface FindBarOptions {
  /** Accessible name of the search box. */
  label: string;
  maxLength?: number;
  /** Go to the next result (`back`: the previous one). */
  step(back: boolean): void;
  /** The query changed; after `debounce` ms of quiet when that is set. */
  input?(query: string): void;
  /** The bar closed (its box and count are already cleared). */
  close?(): void;
  debounce?: number;
}

export interface FindBar {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  /** Results ("1/3", "2페이지 · 1/3", "결과 없음"); the viewer writes it. */
  readonly count: HTMLElement;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
}

export function findBar(o: FindBarOptions): FindBar {
  const element = document.createElement("div");
  element.className = "va-find";
  element.setAttribute("role", "search");
  element.hidden = true;
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "찾기";
  input.setAttribute("aria-label", o.label);
  if (o.maxLength) input.maxLength = o.maxLength;
  const count = document.createElement("span");
  count.className = "va-find-count";
  count.setAttribute("role", "status");
  const previous = iconButton("이전 결과", "previous", "Shift+Enter");
  const next = iconButton("다음 결과", "next", "Enter");
  const closeButton = iconButton("찾기 닫기", "close", "Esc");
  element.append(input, count, previous, next, closeButton);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const flush = () => { cancel(); o.input?.(input.value); };
  input.oninput = () => {
    if (!o.debounce) { o.input?.(input.value); return; }
    cancel();
    timer = setTimeout(flush, o.debounce);
  };
  const close = () => {
    cancel();
    input.value = "";
    count.textContent = "";
    element.hidden = true;
    o.close?.();
  };
  input.onkeydown = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Typed faster than the pause: this Enter shows the first result, it does not skip it.
    if (timer !== undefined) flush();
    else o.step(e.shiftKey);
  };
  previous.onclick = () => o.step(true);
  next.onclick = () => o.step(false);
  closeButton.onclick = close;
  return {
    element, input, count,
    get isOpen() { return !element.hidden; },
    open() { element.hidden = false; input.focus(); input.select(); },
    close,
  };
}
