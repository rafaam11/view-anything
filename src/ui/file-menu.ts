// The 파일 menu every viewer builds, in one order: 열기… and 텍스트로 열기… (main.ts routes them),
// then the viewer's own open items, then 최근 파일, then the viewer's commands (save, export…).
import type { MenuItem } from "../three/core/menubar";
import { OPEN_EVENT } from "../open-route";
import { recentMenuBlock } from "./recent-menu";

export function fileMenu(close: () => void, o: { open?: MenuItem[]; actions?: MenuItem[] } = {}): MenuItem[] {
  return [
    { label: "열기…", shortcut: "Ctrl+O", run: () => window.dispatchEvent(new CustomEvent(OPEN_EVENT)) },
    { label: "텍스트로 열기…", shortcut: "Ctrl+Shift+O", run: () => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { text: true } })) },
    ...(o.open ?? []),
    { separator: true },
    recentMenuBlock(close),
    ...(o.actions?.length ? [{ separator: true } as const, ...o.actions] : []),
  ];
}
