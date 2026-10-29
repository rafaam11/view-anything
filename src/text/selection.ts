/** Measure the selected text using the textarea's actual fonts and wrapping.
 * Only used on an explicit search; never rewrites the editor or its undo history. */
export function revealSelection(editor: HTMLTextAreaElement, at: number, length: number): void {
  const style = getComputedStyle(editor), mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed", left: "-100000px", top: "0", visibility: "hidden", pointerEvents: "none",
    boxSizing: "border-box", width: `${editor.clientWidth}px`, whiteSpace: editor.wrap === "off" ? "pre" : "pre-wrap",
    overflowWrap: "break-word", fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
    fontStyle: style.fontStyle, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, tabSize: style.tabSize,
    padding: style.padding, direction: style.direction,
  });
  const selected = document.createElement("span"); selected.textContent = editor.value.slice(at, at + length) || "\u200b";
  const end = editor.value.indexOf("\n", at + length);
  mirror.append(document.createTextNode(editor.value.slice(0, at)), selected, document.createTextNode(editor.value.slice(at + length, end < 0 ? undefined : end)));
  document.body.append(mirror);
  try {
    const bounds = mirror.getBoundingClientRect(), rect = selected.getClientRects()[0]; if (!rect) return;
    editor.scrollTop = Math.max(0, rect.top - bounds.top - editor.clientHeight / 2);
    editor.scrollLeft = editor.wrap === "off" ? Math.max(0, rect.left - bounds.left - editor.clientWidth / 2) : 0;
  } finally { mirror.remove(); }
}
