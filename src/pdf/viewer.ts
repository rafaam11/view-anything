import './viewer.css';
import { getDocument, GlobalWorkerOptions, PasswordResponses, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { platform } from '../platform';
import type { Viewer } from '../registry';

GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

/** Literal, case-insensitive matches retain UTF-16 offsets even when case folding changes length. */
function matchRanges(text: string, query: string): Array<[number, number]> {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(pattern)) { ranges.push([match.index!, match.index! + match[0].length]); if (ranges.length >= 10000) break; }
  return ranges;
}

type OutlineItem = { title: string; dest: string | unknown[] | null; items: OutlineItem[] };
const button = (label: string) => { const b = document.createElement('button'); b.textContent = label; return b; };

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error('PDF 파일이 100 MiB를 초과합니다.');
    const bytes = new Uint8Array(await platform.readFileRaw(path));
    const loading = getDocument({ data: bytes, isEvalSupported: false, enableXfa: false });
    let passwordDialog: HTMLDialogElement | null = null, passwordCancelled = false;
    loading.onPassword = (submit: (password: string) => void, reason: number) => {
      (passwordDialog as HTMLDialogElement | null)?.remove();
      const dialog = document.createElement('dialog'); dialog.className = 'pdf-password'; passwordDialog = dialog;
      const form = document.createElement('form'); form.method = 'dialog';
      const label = document.createElement('label'); label.textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? '암호가 틀렸습니다. 다시 입력하세요.' : 'PDF 암호를 입력하세요.';
      const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'PDF 암호'); label.append(input);
      const confirm = button('열기'), cancel = button('취소'); confirm.type = 'submit'; cancel.type = 'button';
      const abort = () => { passwordCancelled = true; input.value = ''; dialog.remove(); passwordDialog = null; void loading.destroy().catch(() => {}); };
      cancel.onclick = abort; dialog.addEventListener('cancel', e => { e.preventDefault(); abort(); });
      form.onsubmit = e => { e.preventDefault(); const password = input.value; input.value = ''; dialog.remove(); passwordDialog = null; submit(password); };
      form.append(label, confirm, cancel); dialog.append(form); el.replaceChildren(dialog); dialog.showModal(); input.focus();
    };
    let doc: PDFDocumentProxy;
    try { doc = await loading.promise; }
    catch (e) {
      (passwordDialog as HTMLDialogElement | null)?.remove();
      await loading.destroy();
      if (passwordCancelled) throw new Error('PDF 암호 입력을 취소했습니다.');
      if (e instanceof Error && e.name === 'PasswordException') throw new Error('암호로 보호된 PDF는 열 수 없습니다.');
      throw new Error(`PDF를 읽을 수 없습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
    const root = document.createElement('div'); root.className = 'pdf-root';
    const toolbar = document.createElement('header'); toolbar.className = 'pdf-toolbar';
    const prev = button('이전'); const next = button('다음');
    const pageInput = document.createElement('input'); pageInput.type = 'number'; pageInput.min = '1'; pageInput.max = String(doc.numPages); pageInput.setAttribute('aria-label', '페이지');
    const total = document.createElement('span'); total.textContent = `/ ${doc.numPages}`;
    const zoomOut = button('축소'); const zoomLabel = document.createElement('span'); const zoomIn = button('확대');
    const searchInput = document.createElement('input'); searchInput.type = 'search'; searchInput.maxLength = 512; searchInput.placeholder = '문서 검색'; searchInput.setAttribute('aria-label', '문서 검색');
    const search = button('다음 결과'), searchPrev = button('이전 결과'); const status = document.createElement('span'); status.setAttribute('role', 'status');
    toolbar.append(prev, pageInput, total, next, zoomOut, zoomLabel, zoomIn, searchInput, searchPrev, search, status);
    const content = document.createElement('div'); content.className = 'pdf-content';
    const outline = document.createElement('nav'); outline.className = 'pdf-outline'; outline.setAttribute('aria-label', '목차');
    const scroll = document.createElement('div'); scroll.className = 'pdf-scroll';
    const pageContainer = document.createElement('div'); pageContainer.className = 'pdf-page';
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'PDF 페이지');
    let textContainer = document.createElement('div'); textContainer.className = 'textLayer'; pageContainer.append(canvas, textContainer); scroll.append(pageContainer);
    content.append(outline, scroll); root.append(toolbar, content); el.replaceChildren(root);
    let pageNumber = 1, scale = 1, generation = 0, searchGeneration = 0, task: RenderTask | null = null;
    let renderBarrier: Promise<unknown> = Promise.resolve();
    let lastQuery = '', lastFoundPage = 0, lastFoundIndex = -1, textLayer: TextLayer | null = null;
    let pageText: string[] = [], separators: string[] = [];
    const markMatches = () => {
      if (!textLayer) return;
      const query = searchInput.value.trim();
      const divs = textLayer.textDivs, joined = pageText.map((s, i) => s + (separators[i] ?? '')).join('');
      const ranges = matchRanges(joined, query);
      let offset = 0, first = 0, selected: HTMLElement | null = null;
      for (let i = 0; i < divs.length; i++) {
        const div = divs[i], text = pageText[i] ?? ''; div.replaceChildren();
        let start = 0;
        while (first < ranges.length && ranges[first][1] <= offset) first++;
        for (let index = first; index < ranges.length && ranges[index][0] < offset + text.length; index++) {
          const [a, b] = ranges[index];
          const begin = Math.max(a - offset, 0), end = Math.min(b - offset, text.length);
          if (begin >= end) continue;
          div.append(document.createTextNode(text.slice(start, begin))); const mark = document.createElement('mark');
          if (pageNumber === lastFoundPage && index === lastFoundIndex) { mark.className = 'selected'; selected ??= mark; }
          mark.textContent = text.slice(begin, end); div.append(mark); start = end;
        }
        div.append(document.createTextNode(text.slice(start)));
        offset += text.length + (separators[i]?.length ?? 0);
      }
      selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const render = async () => {
      const id = ++generation;
      textLayer?.cancel(); textLayer = null; const freshLayer = document.createElement('div'); freshLayer.className = 'textLayer'; textContainer.replaceWith(freshLayer); textContainer = freshLayer; pageText = []; separators = [];
      const previousTask = task;
      previousTask?.cancel(); task = null;
      if (previousTask) renderBarrier = previousTask.promise.catch(() => {});
      pageInput.value = String(pageNumber); prev.disabled = pageNumber <= 1; next.disabled = pageNumber >= doc.numPages;
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      try {
        await renderBarrier;
        const page = await doc.getPage(pageNumber); if (id !== generation) return;
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        pageContainer.style.width = `${viewport.width}px`; pageContainer.style.height = `${viewport.height}px`; pageContainer.style.setProperty('--scale-factor', String(scale));
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('캔버스를 사용할 수 없습니다.');
        const current = page.render({ canvasContext: ctx, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }); task = current;
        await current.promise; if (id !== generation) return;
        task = null;
        const text = await page.getTextContent(); if (id !== generation) return;
        const layer = new TextLayer({ textContentSource: text, container: freshLayer, viewport }); textLayer = layer;
        await layer.render(); if (id === generation) { pageText = layer.textContentItemsStr; separators = text.items.filter(item => 'str' in item).map(item => 'hasEOL' in item && item.hasEOL ? ' ' : ''); scroll.scrollTop = 0; markMatches(); }
      } catch (e) { if (id === generation) status.textContent = `페이지 표시 오류: ${e instanceof Error ? e.message : String(e)}`; }
    };
    const go = (n: number) => { if (!Number.isFinite(n)) return; pageNumber = Math.max(1, Math.min(doc.numPages, Math.trunc(n))); void render(); };
    prev.onclick = () => go(pageNumber - 1); next.onclick = () => go(pageNumber + 1);
    pageInput.onchange = () => go(Number(pageInput.value));
    zoomOut.onclick = () => { scale = Math.max(0.25, Math.round((scale - 0.25) * 100) / 100); void render(); };
    zoomIn.onclick = () => { scale = Math.min(3, Math.round((scale + 0.25) * 100) / 100); void render(); };
    const find = async (direction: 1 | -1) => {
      const query = searchInput.value.trim(), id = ++searchGeneration;
      if (!query) { status.textContent = '검색어를 입력하세요.'; return; }
      status.textContent = '검색 중…';
      try {
        const start = pageNumber;
        for (let offset = 0; offset < doc.numPages; offset++) {
          const n = ((start - 1 + direction * offset) % doc.numPages + doc.numPages) % doc.numPages + 1;
          const page = await doc.getPage(n); const text = await page.getTextContent();
          if (id !== searchGeneration) return;
          const value = text.items.map(item => 'str' in item ? item.str + (item.hasEOL ? ' ' : '') : '').join('');
          const matches = matchRanges(value, query);
          const current = query === lastQuery && n === lastFoundPage && offset === 0 ? lastFoundIndex : direction > 0 ? -1 : matches.length;
          const index = current + direction;
          if (index >= 0 && index < matches.length) { lastQuery = query; lastFoundPage = n; lastFoundIndex = index; status.textContent = `${n}페이지 ${index + 1}/${matches.length}`; if (n !== pageNumber) go(n); else markMatches(); return; }
        }
        if (query === lastQuery && lastFoundPage === pageNumber) { lastQuery = ''; return find(direction); }
        status.textContent = '검색 결과가 없습니다.';
      } catch (e) { if (id === searchGeneration) status.textContent = `검색 오류: ${e instanceof Error ? e.message : String(e)}`; }
    };
    search.onclick = () => void find(1); searchPrev.onclick = () => void find(-1);
    searchInput.oninput = () => { ++searchGeneration; lastQuery = ''; lastFoundPage = 0; lastFoundIndex = -1; markMatches(); };
    searchInput.onkeydown = e => { if (e.key === 'Enter') search.click(); };
    let outlineCount = 0;
    const addOutline = (items: OutlineItem[], host: HTMLElement, depth: number) => {
      if (depth > 20) return;
      for (const item of items.slice(0, 1000)) {
        if (++outlineCount > 2000) return;
        const line = document.createElement('div'); line.style.paddingInlineStart = `${depth}em`;
        const link = button(item.title || '(제목 없음)'); link.disabled = !item.dest;
        link.onclick = async () => {
          try {
            const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
            if (!dest?.length) return;
            const first = dest[0]; const index = typeof first === 'number' ? first : await doc.getPageIndex(first as { num: number; gen: number });
            go(index + 1);
          } catch { status.textContent = '목차 위치를 열 수 없습니다.'; }
        };
        line.append(link); host.append(line); addOutline(item.items ?? [], host, depth + 1);
      }
    };
    try {
      const entries = await doc.getOutline();
      if (entries?.length) addOutline(entries as OutlineItem[], outline, 0); else outline.hidden = true;
    } catch { outline.hidden = true; }
    await render();
    window.addEventListener('unload', () => { ++generation; ++searchGeneration; task?.cancel(); textLayer?.cancel(); void loading.destroy(); }, { once: true });
  },
};
export default viewer;
