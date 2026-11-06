// The 3D notice banner (app viewer and exported page; no Tauri). Background notes and refusals
// are "info", things that changed on their own (edges switched off, skipped points) "warning",
// failures "error". Only errors interrupt a screen reader (role=alert); the rest are polite.
import { iconButton, textButton } from "../../ui/icons";

export type BannerKind = "info" | "warning" | "error";

export interface BannerAction {
  label: string;
  run: () => void;
}

/** Longest banner text, in characters (longer messages are cut with "…"). */
const BANNER_MAX = 300;

export class Banner {
  readonly root = document.createElement("div");
  private readonly text = document.createElement("span");
  private readonly action = textButton("");
  private onAction: (() => void) | null = null;

  constructor() {
    this.root.className = "va-banner va3d-banner";
    const close = iconButton("닫기", "close");
    close.addEventListener("click", () => (this.root.hidden = true));
    this.action.classList.add("va3d-banner-action");
    this.action.addEventListener("click", () => {
      const run = this.onAction;
      this.onAction = null;
      this.root.hidden = true;
      run?.();
    });
    this.root.append(this.text, close);
    this.root.hidden = true;
  }

  /** Show `message`, optionally with one action button (e.g. a retry) that also closes the banner. */
  show(message: string, action?: BannerAction, kind: BannerKind = "error"): void {
    // Worker and occt errors can be long (stack-like dumps): the banner keeps the start.
    this.text.textContent = message.length > BANNER_MAX ? message.slice(0, BANNER_MAX) + "…" : message;
    this.onAction = action?.run ?? null;
    if (action) {
      this.action.textContent = action.label;
      this.text.after(this.action);
    } else this.action.remove();
    this.root.dataset.kind = kind;
    this.root.setAttribute("role", kind === "error" ? "alert" : "status");
    this.root.hidden = false;
  }

  /** A refusal or a note about something the user asked for; nothing failed. */
  info(message: string): void {
    this.show(message, undefined, "info");
  }
}
