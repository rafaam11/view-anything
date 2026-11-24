import { platform } from "../platform";
import { errorMessage } from "../ui/strings";

/**
 * Links in the document never navigate the window: `#bookmark` scrolls to it, web and mail
 * links open outside, anything else (files, scripts, other schemes) is ignored.
 */
export function followLink(e: MouseEvent, pages: HTMLElement): void {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") ?? "";
  if (href.startsWith("#")) {
    const id = decodeURIComponent(href.slice(1));
    const target = [...pages.querySelectorAll<HTMLElement>("[id], a[name]")].find(t => t.id === id || t.getAttribute("name") === id);
    target?.scrollIntoView({ block: "start" });
    return;
  }
  let url: URL;
  try { url = new URL(href); } catch { return; }
  if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
    void platform.openExternal(url.href).catch(err => { void platform.alert(errorMessage(err)).catch(() => {}); });
  }
}
