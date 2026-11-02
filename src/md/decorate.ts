import { iconButton } from "../ui/icons";

/**
 * A copy button beside each code block. It sits outside the `pre`, which scrolls, and holds only an
 * icon, so it neither moves with the code nor adds text to a selection.
 */
export function addCodeCopyButtons(root: ParentNode, copy: (text: string) => Promise<void>, onError: (e: unknown) => void): void {
  for (const pre of root.querySelectorAll("pre")) {
    const frame = document.createElement("div");
    frame.className = "md-code";
    pre.replaceWith(frame);
    const button = iconButton("코드 복사", "copy");
    button.classList.add("md-code-copy");
    const show = (copied: boolean) => {
      const label = copied ? "복사됨" : "코드 복사";
      button.classList.toggle("copied", copied);
      button.title = label;
      button.setAttribute("aria-label", label);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    button.onclick = (e) => {
      // Raw HTML may wrap a block in a link or summary: the click is for this button only.
      e.preventDefault();
      e.stopPropagation();
      copy((pre.querySelector("code") ?? pre).textContent?.replace(/\n$/, "") ?? "").then(() => {
        show(true);
        clearTimeout(timer);
        timer = setTimeout(() => show(false), 1500);
      }).catch(onError);
    };
    frame.append(pre, button);
  }
}

/** Waits until images under root can paint at their real size, but never longer than `limitMs`. */
export async function imagesReady(root: ParentNode, limitMs = 1500): Promise<void> {
  const images = [...root.querySelectorAll("img")];
  if (images.length === 0) return;
  await Promise.race([
    Promise.allSettled(images.map((image) => image.decode?.())),
    new Promise((resolve) => setTimeout(resolve, limitMs)),
  ]);
}
