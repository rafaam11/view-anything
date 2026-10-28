// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ mode: 'ok', size: 10, destroy: vi.fn() }));
vi.mock('../src/platform', () => ({ platform: { fileSize: async () => mocks.size, readFileRaw: async () => new ArrayBuffer(10) } }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/worker.mjs' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PasswordResponses: { INCORRECT_PASSWORD: 2 },
  TextLayer: class {
    textDivs: HTMLElement[] = []; textContentItemsStr: string[] = [];
    constructor(private options: { container: HTMLElement; textContentSource: { items: Array<{str: string}> } }) {}
    async render() { for (const item of this.options.textContentSource.items) { const span = document.createElement('span'); span.textContent = item.str; this.options.container.append(span); this.textDivs.push(span); this.textContentItemsStr.push(item.str); } }
    cancel() {}
  },
  getDocument: () => mocks.mode === 'challenge' ? (() => {
    let resolve!: (value: unknown) => void, reject!: (reason: Error) => void;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    const task: { promise: Promise<unknown>; onPassword?: (callback: (value: string) => void, reason: number) => void; destroy: () => Promise<void> } = { promise, destroy: async () => { mocks.destroy(); reject(Object.assign(new Error('cancelled'), { name: 'PasswordException' })); } };
    const submit = (value: string) => { if (value !== 'secret') task.onPassword?.(submit, 2); else resolve({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve(), cancel() {} }), getTextContent: async () => ({ items: [{ str: 'opened' }] }) }), getOutline: async () => [] }); };
    queueMicrotask(() => task.onPassword?.(submit, 1)); return task;
  })() : ({
    promise: mocks.mode === 'ok' ? Promise.resolve({
      numPages: 2,
      getPage: async (n: number) => ({ getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve(), cancel() {} }), getTextContent: async () => ({ items: [{ str: n === 1 ? 'alpha' : 'needle' }] }) }),
      getOutline: async () => [{ title: 'Second', dest: [1], items: [] }],
    }) : Promise.reject(Object.assign(new Error('invalid'), { name: mocks.mode === 'password' ? 'PasswordException' : 'InvalidPDFException' })),
    destroy: mocks.destroy,
  }),
}));
import viewer from '../src/pdf/viewer';
const find = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find(b => b.textContent === label)!;
beforeEach(() => { mocks.mode = 'ok'; mocks.size = 10; mocks.destroy.mockClear(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D); });
test('navigates, searches text and follows outline destinations', async () => {
  const root = document.createElement('div'); await viewer.mount(root, 'test.pdf');
  const page = root.querySelector<HTMLInputElement>('input[type=number]')!;
  find(root, '다음').click(); await vi.waitFor(() => expect(page.value).toBe('2'));
  find(root, 'Second').click(); await vi.waitFor(() => expect(page.value).toBe('2'));
  find(root, '이전').click(); await vi.waitFor(() => expect(page.value).toBe('1'));
  root.querySelector<HTMLInputElement>('input[type=search]')!.value = 'needle'; find(root, '다음 결과').click();
  await vi.waitFor(() => expect(page.value).toBe('2'));
  expect(root.querySelector('[role=status]')!.textContent).toContain('2페이지');
  await vi.waitFor(() => expect(root.querySelector('.textLayer mark')?.textContent).toBe('needle'));
});
test('rejects oversized, encrypted and damaged PDFs', async () => {
  const root = document.createElement('div'); mocks.size = 101 * 1024 * 1024;
  await expect(viewer.mount(root, 'large.pdf')).rejects.toThrow('100 MiB');
  mocks.size = 10; mocks.mode = 'password'; await expect(viewer.mount(root, 'locked.pdf')).rejects.toThrow('암호');
  mocks.mode = 'broken'; await expect(viewer.mount(root, 'broken.pdf')).rejects.toThrow('PDF를 읽을 수 없습니다');
  expect(mocks.destroy).toHaveBeenCalledTimes(2);
});
test('password prompt permits retry and cancellation without retaining the password', async () => {
  mocks.mode = 'challenge'; const root = document.createElement('div'); document.body.append(root);
  const opening = viewer.mount(root, 'locked.pdf');
  await vi.waitFor(() => expect(root.querySelector('input[type=password]')).not.toBeNull());
  let input = root.querySelector<HTMLInputElement>('input[type=password]')!; input.value = 'wrong'; root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(root.textContent).toContain('암호가 틀렸습니다'); expect(input.value).toBe('');
  input = root.querySelector<HTMLInputElement>('input[type=password]')!; input.value = 'secret'; root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await opening; expect(root.querySelector('input[type=password]')).toBeNull(); expect(root.querySelector('.textLayer')?.textContent).toContain('opened');
  const second = document.createElement('div'); document.body.append(second); const cancelled = viewer.mount(second, 'locked.pdf');
  await vi.waitFor(() => expect(second.querySelector('input[type=password]')).not.toBeNull()); find(second, '취소').click();
  await expect(cancelled).rejects.toThrow('취소');
});
