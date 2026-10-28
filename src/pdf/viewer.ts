import './viewer.css';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { platform } from '../platform';
import type { Viewer } from '../registry';

GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

type OutlineItem = { title: string; dest: string | unknown[] | null; items: OutlineItem[] };
const button = (label: string) => { const b = document.createElement('button'); b.textContent = label; return b; };

const viewer: Viewer = {
  async mount(el, path) {
    if (await platform.fileSize(path) > MAX_BYTES) throw new Error('PDF 파일이 100 MiB를 초과합니다.');
    const bytes = new Uint8Array(await platform.readFileRaw(path));
    const loading = getDocument({ data: bytes, isEvalSupported: false, enableXfa: false });
    let doc: PDFDocumentProxy;
    try { doc = await loading.promise; }
    catch (e) {
      await loading.destroy();
      if (e instanceof Error && e.name === 'PasswordException') throw new Error('암호로 보호된 PDF는 열 수 없습니다.');
      throw new Error(`PDF를 읽을 수 없습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
    const root = document.createElement('div'); root.className = 'pdf-root';
    const toolbar = document.createElement('header'); toolbar.className = 'pdf-toolbar';
    const prev = button('이전'); const next = button('다음');
    const pageInput = document.createElement('input'); pageInput.type = 'number'; pageInput.min = '1'; pageInput.max = String(doc.numPages); pageInput.setAttribute('aria-label', '페이지');
    const total = document.createElement('span'); total.textContent = `/ ${doc.numPages}`;
    const zoomOut = button('축소'); const zoomLabel = document.createElement('span'); const zoomIn = button('확대');
    const searchInput = document.createElement('input'); searchInput.type = 'search'; searchInput.placeholder = '문서 검색'; searchInput.setAttribute('aria-label', '문서 검색');
    const search = button('찾기'); const status = document.createElement('span'); status.setAttribute('role', 'status');
    toolbar.append(prev, pageInput, total, next, zoomOut, zoomLabel, zoomIn, searchInput, search, status);
    const content = document.createElement('div'); content.className = 'pdf-content';
    const outline = document.createElement('nav'); outline.className = 'pdf-outline'; outline.setAttribute('aria-label', '목차');
    const scroll = document.createElement('div'); scroll.className = 'pdf-scroll';
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'PDF 페이지'); scroll.append(canvas);
    content.append(outline, scroll); root.append(toolbar, content); el.replaceChildren(root);
    let pageNumber = 1, scale = 1, generation = 0, searchGeneration = 0, task: RenderTask | null = null;
    let lastQuery = '', lastFoundPage = 0;
    const render = async () => {
      const id = ++generation; task?.cancel(); task = null;
      pageInput.value = String(pageNumber); prev.disabled = pageNumber <= 1; next.disabled = pageNumber >= doc.numPages;
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      try {
        const page = await doc.getPage(pageNumber); if (id !== generation) return;
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('캔버스를 사용할 수 없습니다.');
        const current = page.render({ canvasContext: ctx, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }); task = current;
        await current.promise; if (id === generation) { task = null; scroll.scrollTop = 0; }
      } catch (e) { if (id === generation) status.textContent = `페이지 표시 오류: ${e instanceof Error ? e.message : String(e)}`; }
    };
    const go = (n: number) => { if (!Number.isFinite(n)) return; pageNumber = Math.max(1, Math.min(doc.numPages, Math.trunc(n))); void render(); };
    prev.onclick = () => go(pageNumber - 1); next.onclick = () => go(pageNumber + 1);
    pageInput.onchange = () => go(Number(pageInput.value));
    zoomOut.onclick = () => { scale = Math.max(0.25, Math.round((scale - 0.25) * 100) / 100); void render(); };
    zoomIn.onclick = () => { scale = Math.min(3, Math.round((scale + 0.25) * 100) / 100); void render(); };
    search.onclick = async () => {
      const query = searchInput.value.trim().toLocaleLowerCase(), id = ++searchGeneration;
      if (!query) { status.textContent = '검색어를 입력하세요.'; return; }
      status.textContent = '검색 중…';
      try {
        const start = query === lastQuery && pageNumber === lastFoundPage ? pageNumber % doc.numPages + 1 : pageNumber;
        for (let offset = 0; offset < doc.numPages; offset++) {
          const n = (start - 1 + offset) % doc.numPages + 1;
          const page = await doc.getPage(n); const text = await page.getTextContent();
          if (id !== searchGeneration) return;
          const value = text.items.map(item => 'str' in item ? item.str : '').join(' ').toLocaleLowerCase();
          if (value.includes(query)) { lastQuery = query; lastFoundPage = n; status.textContent = `${n}페이지에서 찾았습니다.`; go(n); return; }
        }
        status.textContent = '검색 결과가 없습니다.';
      } catch (e) { if (id === searchGeneration) status.textContent = `검색 오류: ${e instanceof Error ? e.message : String(e)}`; }
    };
    searchInput.onkeydown = e => { if (e.key === 'Enter') search.click(); };
    const addOutline = (items: OutlineItem[], host: HTMLElement, depth: number) => {
      if (depth > 20) return;
      for (const item of items.slice(0, 1000)) {
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
    window.addEventListener('unload', () => { ++generation; ++searchGeneration; task?.cancel(); void loading.destroy(); }, { once: true });
  },
};
export default viewer;
