// Wording that several viewers share, so the same event reads the same everywhere.

export const SAVED = "저장했습니다";
export const COPY_SAVED = "복사본을 저장했습니다. 이 창에서는 원본을 계속 편집합니다.";

/** With confirmDiscard's default label 버리기 (leaving edit mode, moving to another file). */
export const DISCARD = "저장하지 않은 변경 내용을 버릴까요?";
/** With the label 닫기 (a close request). */
export const DISCARD_CLOSE = "저장하지 않은 변경 내용을 버리고 닫을까요?";
/** With the label 다시 읽기 (reload, another encoding). */
export const DISCARD_RELOAD = "저장하지 않은 변경 내용을 버리고 파일을 다시 읽을까요?";

/** Save refused because the file changed on disk (text, CSV, JSON/YAML): a warning notice. */
export const CONFLICT_RELOAD = "파일이 외부에서 바뀌었거나 삭제되어 저장하지 않았습니다. 편집 내용은 그대로 있습니다. 다른 이름으로 저장하거나 다시 읽으세요.";
/** The same for Markdown, which reloads from read mode. */
export const CONFLICT_READ_MODE = "파일이 외부에서 바뀌었거나 읽을 수 없어 저장하지 않았습니다. 편집 내용은 그대로 있습니다. 다른 이름으로 저장하거나 읽기 모드에서 다시 여세요.";

/** An error as a sentence: its message, without the "Error: " prefix String(e) adds. */
export function errorMessage(e: unknown): string {
  const text = (e instanceof Error ? e.message : String(e)).replace(/^Error: /, "").trim();
  return text || "알 수 없는 오류";
}
