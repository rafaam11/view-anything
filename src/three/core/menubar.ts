// Top-left text menubar (Windows-app style): titles open dropdown menus; one open at a time,
// hovering another title while open switches, a press outside or Escape closes. Keyboard:
// Alt+<accessKey> opens a menu, arrows move between items and menus. Plain DOM, no Tauri (the
// exported-HTML runtime uses it for its 보기 menu).

export interface MenuAction {
  label: string;
  /** Shown on the right (e.g. "Ctrl+O"); the caller handles the key itself. */
  shortcut?: string;
  run(): void;
  /** Checked on every open. */
  disabled?(): boolean;
  title?: string;
}

export interface MenuCheck {
  label: string;
  /** Read on every open. */
  checked(): boolean;
  run(): void;
  shortcut?: string;
}

export interface MenuSeparator {
  separator: true;
}

/** Arbitrary controls (e.g. mode radios, section sliders); clicks inside keep the menu open. */
export interface MenuBlock {
  element: HTMLElement;
}

export type MenuItem = MenuAction | MenuCheck | MenuSeparator | MenuBlock;

export interface MenuSpec {
  label: string;
  /** Alt+<key> opens this menu (KeyboardEvent.code, so a Korean IME layout still works). */
  accessKey?: string;
  items: MenuItem[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

interface Built {
  spec: MenuSpec;
  title: HTMLButtonElement;
  menu: HTMLElement;
  /** Refresh disabled/checked state before opening. */
  refresh: (() => void)[];
}

export class Menubar {
  readonly root = el("div", "va3d-menubar");
  private readonly menus: Built[] = [];
  private openIndex = -1;

  constructor(specs: readonly MenuSpec[]) {
    this.root.setAttribute("role", "menubar");
    specs.forEach((spec, i) => this.build(spec, i));
    document.addEventListener("pointerdown", (e) => {
      if (this.isOpen && !this.root.contains(e.target as Node)) this.close();
    });
    this.root.addEventListener("keydown", (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.openIndex >= 0;
  }

  private build(spec: MenuSpec, index: number): void {
    const wrap = el("div", "va3d-menu-wrap");
    const title = el("button", "va3d-menu-title");
    title.type = "button";
    title.textContent = spec.label;
    title.setAttribute("role", "menuitem");
    title.setAttribute("aria-haspopup", "menu");
    title.setAttribute("aria-expanded", "false");
    if (spec.accessKey) title.setAttribute("aria-keyshortcuts", `Alt+${spec.accessKey.toUpperCase()}`);
    title.addEventListener("click", () => (this.openIndex === index ? this.close() : this.open(index)));
    title.addEventListener("pointerenter", () => {
      if (this.isOpen && this.openIndex !== index) this.open(index);
    });
    const menu = el("div", "va3d-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", spec.label);
    menu.hidden = true;
    const refresh: (() => void)[] = [];
    for (const item of spec.items) menu.append(this.item(item, refresh));
    wrap.append(title, menu);
    this.root.append(wrap);
    this.menus.push({ spec, title, menu, refresh });
  }

  private item(item: MenuItem, refresh: (() => void)[]): HTMLElement {
    if ("separator" in item) {
      const s = el("div", "va3d-menu-sep");
      s.setAttribute("role", "separator");
      return s;
    }
    if ("element" in item) {
      const box = el("div", "va3d-menu-block");
      box.append(item.element);
      return box;
    }
    const b = el("button", "va3d-menu-item");
    b.type = "button";
    const mark = el("span", "va3d-menu-mark");
    const label = el("span", "va3d-menu-label");
    label.textContent = item.label;
    const key = el("span", "va3d-menu-key");
    key.textContent = item.shortcut ?? "";
    b.append(mark, label, key);
    if ("checked" in item) {
      b.setAttribute("role", "menuitemcheckbox");
      refresh.push(() => {
        const on = item.checked();
        b.setAttribute("aria-checked", String(on));
        mark.textContent = on ? "✓" : "";
      });
      b.addEventListener("click", () => {
        this.close();
        item.run();
      });
    } else {
      b.setAttribute("role", "menuitem");
      if (item.title) b.title = item.title;
      const disabled = () => item.disabled?.() === true;
      refresh.push(() => {
        if (disabled()) b.setAttribute("aria-disabled", "true");
        else b.removeAttribute("aria-disabled");
      });
      b.addEventListener("click", () => {
        if (disabled()) return;
        this.close();
        item.run();
      });
    }
    return b;
  }

  /** Open menu `index` (closing any other); `focusFirst` puts the keyboard on its first item. */
  open(index: number, focusFirst = false): void {
    if (this.openIndex >= 0 && this.openIndex !== index) this.hide(this.openIndex);
    const m = this.menus[index];
    if (!m) return;
    m.refresh.forEach((f) => f());
    m.menu.hidden = false;
    m.title.setAttribute("aria-expanded", "true");
    m.title.classList.add("open");
    this.openIndex = index;
    if (focusFirst) this.items(index)[0]?.focus();
  }

  private hide(index: number): void {
    const m = this.menus[index];
    m.menu.hidden = true;
    m.title.setAttribute("aria-expanded", "false");
    m.title.classList.remove("open");
  }

  /** Close the open menu; false if none was open. */
  close(): boolean {
    if (this.openIndex < 0) return false;
    const index = this.openIndex;
    this.hide(index);
    this.openIndex = -1;
    if (this.root.contains(document.activeElement)) this.menus[index].title.focus();
    return true;
  }

  /** Focusable (enabled) items of a menu, in order. */
  private items(index: number): HTMLElement[] {
    return [...this.menus[index].menu.querySelectorAll<HTMLElement>(":scope > .va3d-menu-item")].filter((b) => b.getAttribute("aria-disabled") !== "true");
  }

  /** Window-level keys (Alt+F, Alt+V, ...): true if handled. */
  handleKey(e: KeyboardEvent): boolean {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    const index = this.menus.findIndex((m) => m.spec.accessKey && e.code === `Key${m.spec.accessKey.toUpperCase()}`);
    if (index < 0) return false;
    e.preventDefault?.();
    this.open(index, true);
    return true;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.openIndex < 0) return;
    const index = this.openIndex;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.hide(index);
      this.openIndex = -1;
      this.menus[index].title.focus();
      return;
    }
    // Inside a block (sliders, radios): arrows belong to the control.
    if ((e.target as HTMLElement | null)?.closest?.(".va3d-menu-block")) return;
    const n = this.menus.length;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      this.open((index + (e.key === "ArrowRight" ? 1 : n - 1)) % n, true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = this.items(index);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = at < 0 ? (e.key === "ArrowDown" ? 0 : items.length - 1) : (at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      items[next].focus();
    }
  }
}
