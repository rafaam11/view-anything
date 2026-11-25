import { iconButton } from "../ui/icons";

/**
 * Folding sections in read mode: a chevron at each top-level heading hides what follows it, up to
 * the next heading of the same or a higher level. It only hides blocks (a class), so the text, the
 * source and the edit mode never change. Headings are keyed by id, so a fold survives a reload of
 * changed content. Anything that takes the reader somewhere (toc, find, links) sends `va:reveal`
 * from the target, which opens the sections around it.
 */
export const REVEAL = "va:reveal";
const HEADING = /^H([1-6])$/;
const HIDDEN = "md-folded-away", CLOSED = "md-fold-closed";

const levelOf = (el: Element) => Number(HEADING.exec(el.tagName)?.[1] ?? 0);

/** Adds the chevrons to the headings directly under `root` and applies `folded` to them. */
export function addSectionFolds(root: HTMLElement, folded: Set<string>): void {
  for (const heading of [...root.children]) {
    if (!levelOf(heading) || !heading.id || heading.querySelector(":scope > .md-fold")) continue;
    const button = iconButton("섹션 접기", "chevron");
    button.classList.add("md-fold");
    button.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const article = heading.parentElement;
      if (!article) return;
      if (folded.has(heading.id)) folded.delete(heading.id); else folded.add(heading.id);
      applyFolds(article, folded);
    };
    heading.prepend(button);
  }
  applyFolds(root, folded);
}

/** Hides what folded sections cover; headings inside a folded section keep their own state. */
export function applyFolds(root: HTMLElement, folded: Set<string>): void {
  let hideTo = 0; // inside a folded section of this level; 0: not folded
  for (const child of [...root.children]) {
    const level = levelOf(child);
    if (level && hideTo && level <= hideTo) hideTo = 0;
    child.classList.toggle(HIDDEN, hideTo > 0);
    if (!level) continue;
    const closed = folded.has(child.id);
    child.classList.toggle(CLOSED, closed);
    const button = child.querySelector<HTMLButtonElement>(":scope > .md-fold");
    if (button) {
      const label = `${closed ? "섹션 펼치기" : "섹션 접기"}: ${(child.textContent ?? "").trim()}`;
      button.setAttribute("aria-label", label); button.title = closed ? "섹션 펼치기" : "섹션 접기";
      button.setAttribute("aria-expanded", String(!closed));
    }
    if (!hideTo && closed) hideTo = level;
  }
}

/** Opens every folded section that hides `target` (an element anywhere inside `root`). */
export function reveal(root: HTMLElement, folded: Set<string>, target: Element): void {
  let block: Element | null = target;
  while (block && block.parentElement !== root) block = block.parentElement;
  if (!block?.classList.contains(HIDDEN)) return;
  // Walking back, each heading of a lower level than any seen so far is a section containing it.
  let below = levelOf(block) || 7;
  for (let el = block.previousElementSibling; el && below > 1; el = el.previousElementSibling) {
    const level = levelOf(el);
    if (!level || level >= below) continue;
    folded.delete(el.id);
    below = level;
  }
  applyFolds(root, folded);
}

/** Every top-level heading folded, or none. */
export function foldAll(root: HTMLElement, folded: Set<string>, fold: boolean): void {
  folded.clear();
  if (fold) for (const child of root.children) if (levelOf(child) && child.id) folded.add(child.id);
  applyFolds(root, folded);
}

/** Asks the article around `target` to open the sections that hide it (no-op outside one). */
export function requestReveal(target: Element): void {
  target.dispatchEvent(new CustomEvent(REVEAL, { bubbles: true }));
}
