// In-app message dialog (Windows 11 style). It replaces the OS message boxes, so every question
// looks like the app and the safe answer stays the default. Plain DOM, no Tauri: platform.ts wraps
// it as confirm/notice/alert. All strings go in as text.
import "./dialog.css";
import { textButton } from "./icons";

export type DialogKind = "info" | "warning" | "error";
export interface DialogButton<T extends string> {
  label: string;
  value: T;
  /** Default "secondary". */
  variant?: "primary" | "secondary" | "danger";
}
export interface DialogOptions<T extends string> {
  title?: string;
  message: string;
  /** Second paragraph in muted text (a path, the consequence). */
  detail?: string;
  /** Default "info"; warning and error are announced as alert dialogs. */
  kind?: DialogKind;
  /** Left to right; the dialog keeps them right-aligned. */
  buttons: readonly DialogButton<T>[];
  /** Focused when the dialog opens: the safe answer. */
  defaultValue: T;
  /** Esc, and any close not made by a button. */
  cancelValue: T;
  /** Extra class for the caller (e.g. the update restart dialog). */
  className?: string;
}

const ICONS: Record<DialogKind, string> = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  warning: '<path d="M12 3 2 20h20Z"/><path d="M12 10v5M12 17.5v.5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
};

let sequence = 0;

export function showDialog<T extends string>(o: DialogOptions<T>): Promise<T> {
  return new Promise((resolve) => {
    const id = `va-dialog-${++sequence}`;
    const kind = o.kind ?? "info";
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.createElement("dialog");
    dialog.className = "va-dialog va-message" + (o.className ? ` ${o.className}` : "");
    dialog.dataset.kind = kind;
    dialog.setAttribute("role", kind === "info" ? "dialog" : "alertdialog");

    const body = document.createElement("div"); body.className = "va-dialog-body";
    const head = document.createElement("div"); head.className = "va-message-head";
    const icon = document.createElement("span"); icon.className = "va-message-icon"; icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;
    const text = document.createElement("div"); text.className = "va-message-text";
    const message = document.createElement("p"); message.className = "va-dialog-message"; message.id = `${id}-message`; message.textContent = o.message;
    const described = [message.id];
    if (o.title) {
      const title = document.createElement("h2"); title.className = "va-dialog-title"; title.id = `${id}-title`; title.textContent = o.title;
      text.append(title);
      dialog.setAttribute("aria-labelledby", title.id);
    } else dialog.setAttribute("aria-labelledby", message.id);
    text.append(message);
    if (o.detail) {
      const detail = document.createElement("p"); detail.className = "va-dialog-detail"; detail.id = `${id}-detail`; detail.textContent = o.detail;
      text.append(detail); described.push(detail.id);
    }
    if (o.title) dialog.setAttribute("aria-describedby", described.join(" "));
    else if (o.detail) dialog.setAttribute("aria-describedby", described.slice(1).join(" "));
    head.append(icon, text); body.append(head);

    const footer = document.createElement("div"); footer.className = "va-dialog-footer";
    let first: HTMLButtonElement | null = null;
    for (const spec of o.buttons) {
      const b = textButton(spec.label, spec.variant ?? "secondary");
      b.onclick = () => finish(spec.value);
      footer.append(b);
      if (spec.value === o.defaultValue) first = b;
    }
    dialog.append(body, footer);

    let done = false;
    function finish(value: T) {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previous?.isConnected) previous.focus();
      resolve(value);
    }
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(o.cancelValue); });
    // Chromium may close a modal without a cancel event (e.g. a second Esc); that is a cancel too.
    dialog.addEventListener("close", () => finish(o.cancelValue));

    document.body.append(dialog);
    dialog.showModal();
    (first ?? footer.querySelector("button"))?.focus();
  });
}

const DIALOG_KEYS = ["Tab", "Enter", " ", "Escape", "ArrowLeft", "ArrowRight"];

/**
 * An in-app modal does not stop the window's key listeners the way an OS dialog does, so this
 * capture listener (install it right after the update guard, before any shortcut) keeps every
 * app shortcut away while a message dialog is open. Inside the top dialog only Tab, Enter, Space,
 * Esc and ←/→ act; held Enter/Space never repeat an answer.
 */
export function initializeDialogInput(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const open = document.querySelectorAll<HTMLDialogElement>("dialog.va-message[open]");
    const top = open[open.length - 1];
    if (!top) return;
    e.stopImmediatePropagation();
    const inside = e.target instanceof Node && top.contains(e.target);
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (!inside || !plain || !DIALOG_KEYS.includes(e.key) || (e.repeat && (e.key === "Enter" || e.key === " "))) {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const buttons = [...top.querySelectorAll<HTMLButtonElement>(".va-dialog-footer button")];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = buttons[Math.min(buttons.length - 1, Math.max(0, (at < 0 ? 0 : at) + (e.key === "ArrowLeft" ? -1 : 1)))];
      next?.focus();
    }
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
