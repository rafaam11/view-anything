// Scene panel: files -> assembly tree, with show/hide per node and remove per file. Plain DOM,
// no three.js. Names go in through textContent only. Only the file nodes and their direct
// children are rendered up front; deeper rows are built the first time their parent is expanded,
// so a STEP file with thousands of parts opens without building thousands of hidden rows.
import { FRAME_LABELS, FRAME_PRESETS, UNIT_LABELS, UNITS, type ObjectFrame } from "./frames";
import { fixedSourceUnit, type SceneFile, type TreeNode } from "./scene-model";

export interface PanelHandlers {
  /** Eye button: the handler applies the change (model + objects); the panel then re-reads `node.visible`. */
  toggle(nodeId: string, visible: boolean): void;
  /** File × button: remove the file (abort it if still loading). Absent: no × (exported HTML). */
  remove?(fileId: string): void;
  /** File ⋯ menu: set the file's source frame and unit (the handler updates the SceneFile). */
  frame?(fileId: string, frame: ObjectFrame): void;
  /** Click on a row (outside its buttons): select that node. */
  select?(nodeId: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function button(className: string, text: string, title: string, action: string): HTMLButtonElement {
  const b = el("button", className);
  b.type = "button";
  b.textContent = text;
  b.title = title;
  b.dataset.action = action;
  return b;
}

/** Below this width the panel starts collapsed (keep in sync with three.css). */
const NARROW = "(max-width: 820px)";

const EYE_ON = "●";
const EYE_OFF = "○";

export class ScenePanel {
  readonly root = el("aside", "va3d-panel");
  private readonly tree = el("div", "va3d-tree");
  private readonly toggleButton = button("va3d-panel-toggle", "◀", "장면 패널 접기", "panel");
  /** Rendered rows by node id, and the tree node each one shows. */
  private readonly rows = new Map<string, { item: HTMLElement; node: TreeNode | null }>();
  /** Display names of the top-level entries (loading or loaded), in panel order. */
  private readonly fileNames = new Map<string, string>();
  /** Loaded files by id (the ⋯ menu reads and shows their source frame and unit). */
  private readonly files = new Map<string, SceneFile>();
  private selected: string | null = null;

  constructor(private readonly handlers: PanelHandlers) {
    const head = el("div", "va3d-panel-head");
    const title = el("span", "va3d-panel-title");
    title.textContent = "장면";
    head.append(this.toggleButton, title);
    this.tree.setAttribute("role", "tree");
    this.tree.setAttribute("aria-label", "장면");
    this.root.append(head, this.tree);
    this.root.addEventListener("click", (e) => this.onClick(e));
    this.root.addEventListener("change", (e) => this.onFrameChange(e));
    this.root.addEventListener("keydown", (e) => {
      // Escape inside an open ⋯ menu, or on its ⋯ button, closes it.
      const t = e.target as HTMLElement | null;
      const item = t?.closest(".va3d-frame-menu, .va3d-more") ? t.closest<HTMLElement>(".va3d-node") : null;
      const menu = item?.querySelector<HTMLElement>(":scope > .va3d-frame-menu");
      if (e.key === "Escape" && item && menu && !menu.hidden) {
        e.stopPropagation();
        this.showFrameMenu(item, menu, false);
        item.querySelector<HTMLButtonElement>(":scope > .va3d-row > .va3d-more")?.focus();
      }
    });
    // A narrow window has no room for the panel next to the toolbar: start collapsed there, and
    // follow resizes across the breakpoint (the user can still open it by hand).
    const narrow = window.matchMedia?.(NARROW);
    if (narrow) {
      this.setCollapsed(narrow.matches);
      narrow.addEventListener("change", (e) => this.setCollapsed(e.matches));
    }
  }

  /** Names of all files in the panel (loading ones included), in order. */
  names(): string[] {
    return [...this.fileNames.values()];
  }

  /** A row for a file that is queued or still loading: name and remove only. */
  addLoading(fileId: string, name: string): void {
    this.placeTop(fileId, () => this.fileItem(fileId, name, null));
    this.fileNames.set(fileId, name);
  }

  /** Show a loaded file (replacing its loading row, if any), expanded to depth 1. */
  addFile(file: SceneFile): void {
    this.placeTop(file.id, () => this.fileItem(file.id, file.name, file.root));
    this.fileNames.set(file.id, file.name);
    this.files.set(file.id, file);
    this.expand(file.root.id);
  }

  removeFile(fileId: string): void {
    const row = this.rows.get(fileId);
    if (row) {
      row.item.remove();
      for (const id of [...this.rows.keys()]) if (id === fileId || id.startsWith(fileId + "/")) this.rows.delete(id);
    }
    this.fileNames.delete(fileId);
    this.files.delete(fileId);
  }

  /**
   * Mark the selected node (null: none). Its ancestors are expanded first, so a node picked in 3D
   * deep in a big assembly gets its row built and scrolled into view.
   */
  setSelected(nodeId: string | null): void {
    if (this.selected) this.paintSelected(this.selected, false);
    this.selected = nodeId;
    if (!nodeId) return;
    const parts = nodeId.split("/");
    for (let i = 1; i < parts.length; i++) this.expand(parts.slice(0, i).join("/"));
    this.paintSelected(nodeId, true);
    const row = this.rows.get(nodeId)?.item.querySelector<HTMLElement>(":scope > .va3d-row");
    row?.scrollIntoView?.({ block: "nearest" });
  }

  private paintSelected(nodeId: string, on: boolean): void {
    const item = this.rows.get(nodeId)?.item;
    if (!item) return;
    item.classList.toggle("selected", on);
    if (on) item.setAttribute("aria-selected", "true");
    else item.removeAttribute("aria-selected");
  }

  /** Re-read a rendered node's visibility (after the model changed). */
  sync(nodeId: string): void {
    const row = this.rows.get(nodeId);
    if (row?.node) this.paintVisible(row.item, row.node);
  }

  /** Put a file's top-level row in place of its previous one (loading -> loaded), or at the end. */
  private placeTop(fileId: string, make: () => HTMLElement): void {
    const old = this.rows.get(fileId);
    if (old) for (const id of [...this.rows.keys()]) if (id === fileId || id.startsWith(fileId + "/")) this.rows.delete(id);
    const item = make();
    if (old) old.item.replaceWith(item);
    else this.tree.append(item);
  }

  private fileItem(fileId: string, name: string, root: TreeNode | null): HTMLElement {
    if (root) return this.nodeItem(root, 0);
    const item = el("div", "va3d-node loading");
    item.dataset.id = fileId;
    item.setAttribute("role", "treeitem");
    const row = el("div", "va3d-row");
    const label = el("span", "va3d-name");
    label.textContent = name;
    label.title = name;
    const status = el("span", "va3d-loading");
    status.textContent = "불러오는 중";
    row.append(el("span", "va3d-twisty-space"), label, status);
    if (this.handlers.remove) row.append(button("va3d-remove", "×", "제거", "remove"));
    item.append(row);
    this.rows.set(fileId, { item, node: null });
    return item;
  }

  private nodeItem(node: TreeNode, depth: number): HTMLElement {
    const item = el("div", "va3d-node");
    item.dataset.id = node.id;
    item.setAttribute("role", "treeitem");
    const row = el("div", "va3d-row");
    row.style.paddingLeft = `${depth * 14 + 4}px`;
    const hasChildren = node.children.length > 0;
    if (hasChildren) {
      row.append(button("va3d-twisty", "▸", "펼치기", "expand"));
      item.setAttribute("aria-expanded", "false");
    } else row.append(el("span", "va3d-twisty-space"));
    const eye = button("va3d-eye", EYE_ON, "표시/숨김", "eye");
    const label = el("span", "va3d-name");
    label.textContent = node.name;
    label.title = node.name;
    row.append(eye, label);
    if (node.kind === "file") {
      if (this.handlers.frame) {
        const more = button("va3d-more", "⋯", "원본 좌표계·단위", "frame");
        more.setAttribute("aria-expanded", "false");
        row.append(more);
      }
      if (this.handlers.remove) row.append(button("va3d-remove", "×", "제거", "remove"));
    }
    item.append(row);
    this.rows.set(node.id, { item, node });
    this.paintVisible(item, node);
    // Rows are rebuilt (loading -> loaded, lazy expand): keep the selection mark.
    if (node.id === this.selected) {
      item.classList.add("selected");
      item.setAttribute("aria-selected", "true");
    }
    item.dataset.depth = String(depth);
    return item;
  }

  /** Open or close a file's ⋯ menu (built on first open), showing the file's current values. */
  private toggleFrameMenu(item: HTMLElement, fileId: string): void {
    const file = this.files.get(fileId);
    if (!file) return;
    let menu = item.querySelector<HTMLElement>(":scope > .va3d-frame-menu");
    if (menu && !menu.hidden) return this.showFrameMenu(item, menu, false);
    if (!menu) {
      menu = el("div", "va3d-frame-menu");
      const frame = this.select("frame", "원본 좌표계", [["as-is", "그대로"], ...FRAME_PRESETS.map((p): [string, string] => [p, FRAME_LABELS[p]])]);
      const unit = this.select("unit", "원본 단위", [["as-is", "그대로"], ...UNITS.map((u): [string, string] => [u, UNIT_LABELS[u]])]);
      menu.append(frame.label, unit.label);
      item.querySelector(":scope > .va3d-row")!.after(menu);
    }
    const [frameSel, unitSel] = [...menu.querySelectorAll("select")];
    frameSel.value = file.sourceFrame;
    const fixed = fixedSourceUnit(file.format);
    unitSel.value = fixed ?? file.sourceUnit;
    unitSel.disabled = fixed !== null;
    unitSel.title = fixed ? "STEP/IGES는 mm로 변환되어 열립니다" : "";
    this.showFrameMenu(item, menu, true);
    frameSel.focus();
  }

  private showFrameMenu(item: HTMLElement, menu: HTMLElement, open: boolean): void {
    menu.hidden = !open;
    item.querySelector(":scope > .va3d-row > .va3d-more")?.setAttribute("aria-expanded", String(open));
  }

  private select(key: string, caption: string, options: [string, string][]): { label: HTMLLabelElement } {
    const label = el("label", "va3d-frame-field");
    const text = el("span");
    text.textContent = caption;
    const sel = el("select");
    sel.dataset.frame = key;
    for (const [value, name] of options) {
      const o = el("option");
      o.value = value;
      o.textContent = name;
      sel.append(o);
    }
    label.append(text, sel);
    return { label };
  }

  private onFrameChange(e: Event): void {
    const sel = e.target as HTMLSelectElement | null;
    const menu = sel?.closest<HTMLElement>(".va3d-frame-menu");
    const fileId = menu?.parentElement?.dataset.id;
    if (!menu || !fileId || !this.files.has(fileId)) return;
    const [frameSel, unitSel] = [...menu.querySelectorAll("select")];
    this.handlers.frame?.(fileId, { frame: frameSel.value as ObjectFrame["frame"], unit: unitSel.value as ObjectFrame["unit"] });
  }

  private paintVisible(item: HTMLElement, node: TreeNode): void {
    item.classList.toggle("off", !node.visible);
    const eye = item.querySelector<HTMLButtonElement>(":scope > .va3d-row > .va3d-eye");
    if (eye) {
      eye.textContent = node.visible ? EYE_ON : EYE_OFF;
      eye.setAttribute("aria-pressed", String(node.visible));
    }
  }

  /** Expand a rendered node, building its child rows the first time. */
  private expand(nodeId: string): void {
    const row = this.rows.get(nodeId);
    if (!row?.node || row.node.children.length === 0) return;
    const { item, node } = row;
    let group = item.querySelector<HTMLElement>(":scope > .va3d-children");
    if (!group) {
      group = el("div", "va3d-children");
      group.setAttribute("role", "group");
      const depth = Number(item.dataset.depth ?? 0) + 1;
      const frag = document.createDocumentFragment();
      for (const child of node.children) frag.append(this.nodeItem(child, depth));
      group.append(frag);
      item.append(group);
    }
    group.hidden = false;
    this.setTwisty(item, true);
  }

  private collapse(nodeId: string): void {
    const item = this.rows.get(nodeId)?.item;
    const group = item?.querySelector<HTMLElement>(":scope > .va3d-children");
    if (!item || !group) return;
    group.hidden = true;
    this.setTwisty(item, false);
  }

  private setTwisty(item: HTMLElement, open: boolean): void {
    item.setAttribute("aria-expanded", String(open));
    const t = item.querySelector<HTMLButtonElement>(":scope > .va3d-row > .va3d-twisty");
    if (t) {
      t.textContent = open ? "▾" : "▸";
      t.title = open ? "접기" : "펼치기";
    }
  }

  get collapsed(): boolean {
    return this.root.classList.contains("collapsed");
  }

  setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle("collapsed", collapsed);
    this.tree.hidden = collapsed;
    this.toggleButton.textContent = collapsed ? "▶" : "◀";
    this.toggleButton.title = collapsed ? "장면 패널 펼치기" : "장면 패널 접기";
  }

  private onClick(e: Event): void {
    const target = e.target as HTMLElement | null;
    const b = target?.closest<HTMLButtonElement>("button[data-action]");
    if (!b || !this.root.contains(b)) {
      // A click on a row (name or blank part, not a button or the ⋯ menu) selects its node.
      const rowEl = target?.closest(".va3d-row");
      const id = rowEl?.parentElement?.dataset.id;
      if (rowEl && !target?.closest("button, select, label") && id && this.rows.get(id)?.node) this.handlers.select?.(id);
      return;
    }
    if (b.dataset.action === "panel") return this.setCollapsed(!this.root.classList.contains("collapsed"));
    const item = b.closest<HTMLElement>(".va3d-node");
    const id = item?.dataset.id;
    if (!item || !id) return;
    switch (b.dataset.action) {
      case "expand":
        if (item.getAttribute("aria-expanded") === "true") this.collapse(id);
        else this.expand(id);
        break;
      case "eye": {
        const node = this.rows.get(id)?.node;
        if (!node) return;
        this.handlers.toggle(id, !node.visible);
        this.paintVisible(item, node);
        break;
      }
      case "remove":
        this.handlers.remove?.(id);
        break;
      case "frame":
        this.toggleFrameMenu(item, id);
        break;
    }
  }
}
