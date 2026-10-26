// WYSIWYG editor (Milkdown Crepe). Everything heavy — Crepe, ProseMirror, CodeMirror and the
// editor CSS — is imported only when the user enters edit mode, never at startup.

export interface Editor {
  getMarkdown(): string;
  destroy(): void;
}

export interface EditorOptions {
  /** Maps an image src from the markdown to a URL the webview can load (display only). */
  imageUrl?: (src: string) => string;
  /** Called with the serialized markdown after the document changes (debounced by Milkdown). */
  onChange?: (markdown: string) => void;
}

function previewElement(html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "va-preview";
  el.innerHTML = html;
  return el;
}

export async function createEditor(el: HTMLElement, markdown: string, opts: EditorOptions = {}): Promise<Editor> {
  const [{ Crepe }, { remarkStringifyOptionsCtx }, { default: katex }] = await Promise.all([
    import("@milkdown/crepe"),
    import("@milkdown/kit/core"),
    import("katex"),
    import("@milkdown/crepe/theme/common/style.css"),
    import("./editor.css"),
  ]);

  const crepe = new Crepe({
    root: el,
    defaultValue: markdown,
    featureConfigs: {
      [Crepe.Feature.CodeMirror]: {
        // Diagrams and formulas show rendered; the toggle reveals the source.
        previewOnlyByDefault: true,
        renderPreview: (language, content, applyPreview) => {
          const lang = language.toLowerCase();
          if (!content.trim()) return null;
          if (lang === "math") {
            return previewElement(katex.renderToString(content, { displayMode: true, throwOnError: false }));
          }
          if (lang === "mermaid") {
            import("./mermaid")
              .then(({ mermaidSvg }) => mermaidSvg(content))
              .then(
                (svg) => applyPreview(previewElement(svg)),
                (e) => {
                  const err = document.createElement("pre");
                  err.className = "va-preview-error";
                  err.textContent = String(e);
                  applyPreview(err);
                },
              );
            return undefined; // async preview
          }
          return null;
        },
      },
      [Crepe.Feature.ImageBlock]: {
        proxyDomURL: (url) => opts.imageUrl?.(url) ?? url,
      },
    },
  });

  // Serialize like typical hand-written markdown so edited blocks diff minimally.
  crepe.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: "-" as const }));
  });

  if (opts.onChange) {
    const onChange = opts.onChange;
    crepe.on((api) => api.markdownUpdated((_ctx, md) => onChange(md)));
  }

  await crepe.create();
  return {
    getMarkdown: () => crepe.getMarkdown(),
    destroy: () => void crepe.destroy(),
  };
}
