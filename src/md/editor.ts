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
  const [{ Crepe }, { remarkStringifyOptionsCtx, editorViewCtx, editorViewOptionsCtx }, { imageSchema }, { default: katex }, { attachCodePreviewSwitch }] = await Promise.all([
    import("@milkdown/crepe"),
    import("@milkdown/kit/core"),
    import("@milkdown/kit/preset/commonmark"),
    import("katex"),
    import("./code-preview"),
    import("@milkdown/crepe/theme/common/style.css"),
    import("./editor.css"),
  ]);

  const crepe = new Crepe({
    root: el,
    defaultValue: markdown,
    features: {
      // ImageBlock stores the display ratio in the alt text (`![1.00](…)`) and its upload UI
      // inserts blob: URLs. Plain inline images keep alt/title as written.
      [Crepe.Feature.ImageBlock]: false,
    },
    featureConfigs: {
      [Crepe.Feature.CodeMirror]: {
        // Diagrams and formulas show rendered until the cursor enters them (see code-preview.ts).
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
    },
  });

  // Serialize like typical hand-written markdown so edited blocks diff minimally.
  crepe.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: "-" as const }));
  });

  // No browser spellcheck squiggles (Korean text) in the editable root.
  crepe.editor.config((ctx) => {
    ctx.update(editorViewOptionsCtx, (prev) => ({
      ...prev,
      attributes: (state) => {
        const base = typeof prev.attributes === "function" ? prev.attributes(state) : prev.attributes;
        return { ...(base ?? {}), spellcheck: "false" };
      },
    }));
  });

  // Relative image paths do not resolve inside the webview; show them through `imageUrl` but keep
  // the written src in the document (and in copied HTML via data-src).
  const imageUrl = opts.imageUrl;
  if (imageUrl) {
    crepe.editor.use(
      imageSchema.extendSchema((prev) => (ctx) => {
        const base = prev(ctx);
        return {
          ...base,
          parseDOM: [
            {
              tag: "img[src]",
              getAttrs: (dom) => {
                const img = dom as HTMLElement;
                return {
                  src: img.getAttribute("data-src") ?? img.getAttribute("src") ?? "",
                  alt: img.getAttribute("alt") ?? "",
                  title: img.getAttribute("title") ?? "",
                };
              },
            },
          ],
          toDOM: (node) => ["img", { ...node.attrs, src: imageUrl(node.attrs.src as string), "data-src": node.attrs.src }],
        };
      }),
    );
  }

  const host = el;
  const previews = attachCodePreviewSwitch(host);
  // Keyboard navigation into a code block moves the ProseMirror selection there: show its source.
  crepe.on((api) =>
    api.selectionUpdated((ctx, selection) => {
      const view = ctx.get(editorViewCtx);
      const node = (selection as { node?: { type: { name: string } } }).node;
      let pos: number | undefined;
      if (node?.type.name === "code_block") pos = selection.from;
      else if (selection.$from.parent.type.name === "code_block") pos = selection.$from.before();
      const dom = pos === undefined ? null : view.nodeDOM(pos);
      if (dom instanceof Element) void previews.reveal(dom);
    }),
  );

  if (opts.onChange) {
    const onChange = opts.onChange;
    crepe.on((api) => api.markdownUpdated((_ctx, md) => onChange(md)));
  }

  await crepe.create();
  return {
    getMarkdown: () => crepe.getMarkdown(),
    destroy: () => {
      previews.dispose();
      void crepe.destroy();
    },
  };
}
