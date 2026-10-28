// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ mode: 'ok', size: 10, destroy: vi.fn() }));
vi.mock('../src/platform', () => ({ platform: { fileSize: async () => mocks.size, readFileRaw: async () => new ArrayBuffer(10) } }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/worker.mjs' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
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
  root.querySelector<HTMLInputElement>('input[type=search]')!.value = 'needle'; find(root, '찾기').click();
  await vi.waitFor(() => expect(page.value).toBe('2'));
  expect(root.querySelector('[role=status]')!.textContent).toContain('2페이지');
});
test('rejects oversized, encrypted and damaged PDFs', async () => {
  const root = document.createElement('div'); mocks.size = 101 * 1024 * 1024;
  await expect(viewer.mount(root, 'large.pdf')).rejects.toThrow('100 MiB');
  mocks.size = 10; mocks.mode = 'password'; await expect(viewer.mount(root, 'locked.pdf')).rejects.toThrow('암호');
  mocks.mode = 'broken'; await expect(viewer.mount(root, 'broken.pdf')).rejects.toThrow('PDF를 읽을 수 없습니다');
  expect(mocks.destroy).toHaveBeenCalledTimes(2);
});
