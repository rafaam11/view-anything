import { diffArrays } from "diff";

/** Reapply original line endings to a browser textarea's LF-normalized contents. */
export function restoreLineEndings(original: string, edited: string): string {
  const oldLines = original.split(/\r\n|\r|\n/);
  const oldEndings = original.match(/\r\n|\r|\n/g) ?? [];
  const newLines = edited.replace(/\r\n|\r/g, "\n").split("\n");
  const diff = diffArrays(oldLines, newLines, { maxEditLength: 2000 });
  if (!diff) throw new Error("수정 범위가 너무 커서 줄바꿈을 보존할 수 없습니다.");
  const fallback = oldEndings[0] ?? "\n";
  let oldIndex = 0, result = "", newIndex = 0, removed: string[] = [];
  for (const part of diff) {
    if (part.removed) {
      for (const _ of part.value) removed.push(oldEndings[oldIndex++] ?? fallback);
    } else {
      for (const line of part.value) {
        const ending = part.added ? (removed.shift() ?? fallback) : (oldEndings[oldIndex++] ?? fallback);
        result += line;
        if (++newIndex < newLines.length) result += ending;
      }
      if (!part.added) removed = [];
    }
  }
  return result;
}
