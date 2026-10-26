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

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** How the file on disk (`null`: unreadable/missing) relates to the bytes last read or written. */
export function diskState(known: Uint8Array, onDisk: Uint8Array | null): "same" | "changed" | "missing" {
  if (onDisk === null) return "missing";
  return bytesEqual(known, onDisk) ? "same" : "changed";
}

/**
 * Right before saving: another program (an AI agent, another window) may have changed the file
 * since we read it. Overwriting that silently would revert its changes, so ask first.
 */
export function beforeWrite(known: Uint8Array, onDisk: Uint8Array | null): "write" | "confirm-overwrite" {
  return diskState(known, onDisk) === "changed" ? "confirm-overwrite" : "write";
}

/** Read mode follows the file on disk; edit mode and in-flight tasks are never disturbed. */
export function shouldReloadOnFocus(
  state: { mode: Mode; busy: boolean },
  known: Uint8Array,
  onDisk: Uint8Array | null,
): boolean {
  return state.mode === "read" && !state.busy && diskState(known, onDisk) === "changed";
}
