import type { Heading } from "./render";

const KEY = "va.toc.collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Collapsible sidebar listing headings; highlights the heading at the current scroll position.
 * Call `dispose` before replacing the toc so scroll listeners do not pile up across re-renders.
 */
export function buildToc(headings: Heading[], article: HTMLElement): { nav: HTMLElement; dispose: () => void } {
  const nav = document.createElement("nav");
  nav.className = "toc";
  nav.classList.toggle("collapsed", loadCollapsed());

  const toggle = document.createElement("button");
  toggle.className = "toc-toggle";
  toggle.textContent = "목차";
  toggle.title = "목차 접기/펼치기";
  toggle.onclick = () => {
    const c = nav.classList.toggle("collapsed");
    try {
      localStorage.setItem(KEY, c ? "1" : "0");
    } catch {}
  };

  const list = document.createElement("ul");
  const links = new Map<string, HTMLAnchorElement>();
  const minDepth = Math.min(...headings.map((h) => h.depth), 6);
  for (const h of headings) {
    const li = document.createElement("li");
    li.style.paddingLeft = `${(h.depth - minDepth) * 12}px`;
    const a = document.createElement("a");
    a.href = "#" + encodeURIComponent(h.id);
    a.textContent = h.text;
    a.onclick = (e) => {
      e.preventDefault();
      document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    links.set(h.id, a);
    li.append(a);
    list.append(li);
  }
  nav.append(toggle, list);

  const targets = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
  let active: HTMLAnchorElement | undefined;
  const update = () => {
    let cur = targets[0];
    for (const t of targets) {
      if (t.getBoundingClientRect().top <= 80) cur = t;
      else break;
    }
    const next = cur ? links.get(cur.id) : undefined;
    if (next === active) return;
    active?.classList.remove("active");
    next?.classList.add("active");
    next?.scrollIntoView({ block: "nearest" });
    active = next;
  };
  const win = article.ownerDocument.defaultView;
  win?.addEventListener("scroll", update, { passive: true });
  queueMicrotask(update);
  return { nav, dispose: () => win?.removeEventListener("scroll", update) };
}
