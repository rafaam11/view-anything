import { SpliceError, joinFrontmatter, spliceMarkdown, splitFrontmatter } from "./splice";

export type Mode = "read" | "edit";

/** Leaving (closing, navigating, back to read mode) discards unsaved edits, so ask first. */
export function shouldConfirmLeave(state: { mode: Mode; dirty: boolean }): boolean {
  return state.mode === "edit" && state.dirty;
}

export type SavePlan =
  | { kind: "unchanged" }
  /** Only the edited blocks were replaced in the original text. */
  | { kind: "splice"; text: string }
  /** Source preservation is impossible; `text` rewrites the whole body from the editor. */
  | { kind: "rewrite"; text: string; reason: string };

/**
 * Decide what to write. `original` is the whole (LF-normalized) file, `baseline` the editor's
 * serialization of its body right after load and `edited` its current serialization.
 * Frontmatter is never seen by the editor and is always kept byte-exact.
 */
export function planSave(original: string, baseline: string, edited: string): SavePlan {
  if (edited === baseline) return { kind: "unchanged" };
  const { head, body } = splitFrontmatter(original);
  try {
    const out = spliceMarkdown(body, baseline, edited);
    return out === null ? { kind: "unchanged" } : { kind: "splice", text: joinFrontmatter(head, out) };
  } catch (e) {
    if (!(e instanceof SpliceError)) throw e;
    return { kind: "rewrite", text: joinFrontmatter(head, edited), reason: e.message };
  }
}
