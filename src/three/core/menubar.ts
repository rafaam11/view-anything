// Top-left text menubar (Windows-app style): titles open dropdowns; one open at a time, hovering
// another title while open switches, a press outside or Escape closes. Keyboard: Alt+<accessKey>
// opens a menu, arrows / Home / End move between items, ←→ between menus. Plain DOM, no Tauri (the
// exported-HTML runtime uses it for its 보기 menu).
//
// Semantics: a dropdown is a plain popover. Its command items sit in role="menu" lists; control
// blocks (radios, sliders) are role="group" siblings outside them, so menu semantics never wrap
// form controls.

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
  /** Accessible name of the control group. */
  label?: string;
}

export type MenuItem = MenuAction | MenuCheck | MenuSeparator | MenuBlock;

export interface MenuSpec {
  label: string;
  /** Alt+<key> opens this menu (KeyboardEvent.code, so a Korean IME layout still works). */
  accessKey?: string;
  items: MenuItem[];
}

export interface MenubarOptions {
  /** Where the keyboard goes after a command ran (e.g. the 3D canvas); default: nowhere special. */
  focusAfter?(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

interface Built {
  spec: MenuSpec;
  title: HTMLButtonElement;
  /** The popover (shown/hidden). */
  menu: HTMLElement;
  /** Refresh disabled/checked state before opening. */
  refresh: (() => void)[];
}

export class Menubar {
  readonly root = el("div", "va3d-menubar");
  private readonly menus: Built[] = [];
  private openIndex = -1;
  private readonly onDocumentDown = (e: PointerEvent) => {
    if (this.isOpen && !this.root.contains(e.target as Node)) this.close();
  };

  constructor(
    specs: readonly MenuSpec[],
    private readonly options: MenubarOptions = {},
  ) {
    this.root.setAttribute("role", "menubar");
    specs.forEach((spec, i) => this.build(spec, i));
    document.addEventListener("pointerdown", this.onDocumentDown);
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
    title.setAttribute("aria-haspopup", "true");
    title.setAttribute("aria-expanded", "false");
    if (spec.accessKey) title.setAttribute("aria-keyshortcuts", `Alt+${spec.accessKey.toUpperCase()}`);
    title.addEventListener("click", () => (this.openIndex === index ? this.close() : this.open(index)));
    title.addEventListener("pointerenter", () => {
      if (this.isOpen && this.openIndex !== index) this.open(index);
    });
    const menu = el("div", "va3d-menu");
    menu.hidden = true;
    const refresh: (() => void)[] = [];
    let list: HTMLElement | null = null;
    for (const item of spec.items) {
      if ("element" in item) {
        const box = el("div", "va3d-menu-block");
        box.setAttribute("role", "group");
        box.setAttribute("aria-label", item.label ?? spec.label);
        box.append(item.element);
        menu.append(box);
        list = null;
        continue;
      }
      if (!list) {
        list = el("div", "va3d-menu-list");
        list.setAttribute("role", "menu");
        list.setAttribute("aria-label", spec.label);
        menu.append(list);
      }
      list.append(this.item(item, refresh));
    }
    wrap.append(title, menu);
    this.root.append(wrap);
    this.menus.push({ spec, title, menu, refresh });
  }

  private item(item: MenuAction | MenuCheck | MenuSeparator, refresh: (() => void)[]): HTMLElement {
    if ("separator" in item) {
      const s = el("div", "va3d-menu-sep");
      s.setAttribute("role", "separator");
      return s;
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
      b.addEventListener("click", () => this.activate(item.run));
    } else {
      b.setAttribute("role", "menuitem");
      if (item.title) b.title = item.title;
      const disabled = () => item.disabled?.() === true;
      refresh.push(() => {
        if (disabled()) b.setAttribute("aria-disabled", "true");
        else b.removeAttribute("aria-disabled");
      });
      b.addEventListener("click", () => {
        if (!disabled()) this.activate(item.run);
      });
    }
    return b;
  }

  /** A command ran: close, hand the keyboard back (e.g. to the canvas, so F and 1-7 work), run it. */
  private activate(run: () => void): void {
    this.hideOpen();
    if (this.options.focusAfter) this.options.focusAfter();
    else if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    run();
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

  private hideOpen(): number {
    const index = this.openIndex;
    if (index >= 0) this.hide(index);
    this.openIndex = -1;
    return index;
  }

  /** Close the open menu (keyboard focus inside goes back to its title); false if none was open. */
  close(): boolean {
    const index = this.hideOpen();
    if (index < 0) return false;
    if (this.root.contains(document.activeElement)) this.menus[index].title.focus();
    return true;
  }

  /** Focusable (enabled) command items of a menu, in order. */
  private items(index: number): HTMLElement[] {
    return [...this.menus[index].menu.querySelectorAll<HTMLElement>(".va3d-menu-item")].filter((b) => b.getAttribute("aria-disabled") !== "true");
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
      this.hideOpen();
      this.menus[index].title.focus();
      return;
    }
    // Inside a control group (sliders, radios): arrows and Home/End belong to the control.
    if ((e.target as HTMLElement | null)?.closest?.(".va3d-menu-block")) return;
    const n = this.menus.length;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      this.open((index + (e.key === "ArrowRight" ? 1 : n - 1)) % n, true);
      return;
    }
    const items = this.items(index);
    if (items.length === 0) return;
    let next: number | null = null;
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
    else if (e.key === "ArrowUp") next = at < 0 ? items.length - 1 : (at + items.length - 1) % items.length;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  }

  /** Remove the document listener (the root's listeners go with the element). */
  dispose(): void {
    document.removeEventListener("pointerdown", this.onDocumentDown);
    this.hideOpen();
  }
}
