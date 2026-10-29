/** Measure the selected text using the textarea's actual fonts and wrapping.
 * Only used on an explicit search; never rewrites the editor or its undo history. */
export async function revealSelection(editor: HTMLTextAreaElement, at: number, length: number, current = () => true): Promise<boolean> {
  const style = getComputedStyle(editor), mirror = document.createElement("div");
  const left = parseFloat(style.paddingLeft) || 0, right = parseFloat(style.paddingRight) || 0, top = parseFloat(style.paddingTop) || 0;
  const value = editor.value;
  Object.assign(mirror.style, {
    position: "fixed", left: "-100000px", top: "0", visibility: "hidden", pointerEvents: "none",
    width: `${Math.max(1, editor.clientWidth - left - right)}px`, whiteSpace: editor.wrap === "off" ? "pre" : "pre-wrap",
    overflowWrap: "break-word", fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
    fontStyle: style.fontStyle, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, tabSize: style.tabSize,
    padding: "0", margin: "0", direction: style.direction,
  });
  document.body.append(mirror);
  try {
    let from = 0, height = 0;
    if (editor.wrap === "off") {
      mirror.textContent = "M";
      const lineHeight = mirror.getBoundingClientRect().height;
      let lines = 0, next = value.indexOf("\n");
      while (next >= 0 && next < at) { lines++; from = next + 1; next = value.indexOf("\n", from); }
      height = lines * lineHeight;
    }
    // Hard lines wrap independently. Measure bounded groups, yielding between layouts
    // so a large file cannot freeze input while finding a match near its end.
    while (editor.wrap !== "off" && from + 64 * 1024 < at) {
      let cut = value.lastIndexOf("\n", from + 64 * 1024) + 1;
      if (cut <= from) cut = value.indexOf("\n", from + 64 * 1024) + 1;
      if (cut <= from || cut > at) break;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!current()) return false;
      mirror.textContent = value.slice(from, cut);
      height += mirror.getBoundingClientRect().height; from = cut;
    }
    if (!current()) return false;
    const selected = document.createElement("span"); selected.textContent = value.slice(at, at + length) || "\u200b";
    const end = value.indexOf("\n", at + length);
    mirror.replaceChildren(document.createTextNode(value.slice(from, at)), selected, document.createTextNode(value.slice(at + length, end < 0 ? undefined : end)));
    const bounds = mirror.getBoundingClientRect(), rect = selected.getClientRects()[0]; if (!rect) return false;
    editor.scrollTop = Math.max(0, height + top + rect.top - bounds.top - editor.clientHeight / 2);
    editor.scrollLeft = editor.wrap === "off" ? Math.max(0, left + rect.left - bounds.left - editor.clientWidth / 2) : 0;
    return true;
  } finally { mirror.remove(); }
}
