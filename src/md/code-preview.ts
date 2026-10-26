// Typora-style code blocks for the Crepe editor: a block with a preview (mermaid, math) shows the
// rendered preview until the cursor enters it, then the source; leaving shows the preview again.
// Crepe keeps the preview-only state private, so this drives its own toggle button through the DOM:
// `.codemirror-host.hidden` means "showing the preview only".

const BLOCK = ".milkdown-code-block";

function previewing(block: Element): boolean {
  return block.querySelector(".codemirror-host")?.classList.contains("hidden") ?? false;
}

function toggle(block: Element) {
  block.querySelector<HTMLElement>(".preview-toggle-button")?.click();
}

/** Lets Crepe's (Vue) view apply the toggle before the source is focused. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

export interface CodePreviewSwitch {
  /** Shows the source of `block` and focuses it (cursor entered the block). */
  reveal(block: Element): Promise<void>;
  dispose(): void;
}

export function attachCodePreviewSwitch(root: HTMLElement): CodePreviewSwitch {
  const reveal = async (block: Element) => {
    if (!previewing(block)) return;
    toggle(block);
    await settle();
    if (!block.contains(document.activeElement)) block.querySelector<HTMLElement>(".cm-content")?.focus();
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as Element;
    const block = target.closest(BLOCK);
    if (block && target.closest(".preview-panel") && previewing(block)) void reveal(block);
  };

  /** The block the cursor is in, if any. */
  let current: Element | null = null;

  const onFocusIn = (e: FocusEvent) => {
    current = (e.target as Element).closest(BLOCK);
  };

  const onFocusOut = (e: FocusEvent) => {
    const block = (e.target as Element).closest(BLOCK);
    if (!block || block.contains(e.relatedTarget as Node | null)) return;
    setTimeout(() => {
      // Window blur (dialogs, app switch) is not leaving the block.
      if (!document.hasFocus() || block.contains(document.activeElement)) return;
      if (current === block) current = null;
      if (!previewing(block)) toggle(block);
    }, 0);
  };

  // A block gets a preview once it has content (e.g. a new mermaid block) and Crepe then hides the
  // source; while the cursor is in that block, switch straight back to the source.
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const host = r.target as Element;
      if (!host.classList.contains("codemirror-host") || !host.classList.contains("hidden")) continue;
      const block = host.closest(BLOCK);
      if (block && block === current) {
        toggle(block);
        void settle().then(() => {
          if (!block.contains(document.activeElement)) block.querySelector<HTMLElement>(".cm-content")?.focus();
        });
      }
    }
  });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["class"] });

  root.addEventListener("click", onClick, true);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  return {
    reveal,
    dispose() {
      observer.disconnect();
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    },
  };
}
