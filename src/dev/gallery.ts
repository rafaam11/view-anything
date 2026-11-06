// Dev-only UI gallery: the app's controls, surfaces and dialogs on one page, in either theme, for
// screenshots before and after style work. Served by `npx vite` at /ui-gallery.html; the
// production build only takes index.html, so nothing here ships. No Tauri command is called.
//   ?theme=light|dark   ?view=doc|3d   ?menu=open   ?scene=settings|restart|restart-dirty|pdf-password
// The 3D stylesheet is only loaded in 3D windows, so the 3D view is a separate page state.
import "../ui/tokens.css";
import "../ui/base.css";
import "../ui/dialog.css";
import "../styles.css";
import "../ui/chrome.css";
import "../titlebar.css";
import "../md/md.css";
import "../text/viewer.css";
import "../data/data.css";
import "../pdf/viewer.css";
import "../image/viewer.css";
import { documentBar } from "../ui/chrome";
import { iconButton, menuButton, textButton, type ButtonVariant } from "../ui/icons";
import { mountTitlebar } from "../titlebar";
import { updateBadge, confirmRestart } from "../update/badge";
import { createFind } from "../md/find";
import { buildToolbar } from "../three/core/view-menu";
import { initializeDialogInput, showDialog } from "../ui/dialog";

const params = new URLSearchParams(location.search);
const view3d = params.get("view") === "3d";
if (view3d) { await import("../three/core/three.css"); await import("../three/cloud/pointcloud.css"); }
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
const app = document.getElementById("app") as HTMLElement;

const style = document.createElement("style");
style.textContent = [
  "html, body { overflow: auto !important; height: auto; }",
  "#app { position: static; overflow: visible; padding-top: var(--va-titlebar-height, 32px); }",
  ".g-section { margin: 16px; padding: 12px; border: 1px dashed var(--border); position: relative; }",
  ".g-section > h3 { margin: 0 0 8px; font: 600 12px system-ui; color: var(--muted); }",
  ".g-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }",
  ".g-section .va3d { position: relative; inset: auto; height: 220px; }",
  ".g-section .va-update { position: static; display: inline-flex; }",
  ".g-section .md-find { position: static; }",
  ".g-section .md-root { min-height: 0; }",
  ".g-section .text-root { height: auto; }",
  ".g-section .empty { position: static; height: auto; }",
].join("\n");
document.head.append(style);

const fakeWindow = {
  minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {},
  isMaximized: async () => false, isFullscreen: async () => false, onResized: async () => () => {},
  setTheme: async () => {}, isAlwaysOnTop: async () => false, setAlwaysOnTop: async () => {},
};
mountTitlebar(document.body, fakeWindow as never);

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const s = document.createElement("section"); s.className = "g-section";
  const h = document.createElement("h3"); h.textContent = title;
  s.append(h, ...children); app.append(s); return s;
}
function row(...children: (HTMLElement | string)[]): HTMLDivElement {
  const r = document.createElement("div"); r.className = "g-row"; r.append(...children); return r;
}
function button(label: string, opts: { variant?: ButtonVariant; cls?: string; disabled?: boolean } = {}): HTMLButtonElement {
  const b = textButton(label, opts.variant);
  if (opts.cls) b.classList.add(opts.cls);
  b.disabled = !!opts.disabled; return b;
}
function input(type: string, value = ""): HTMLInputElement {
  const i = document.createElement("input"); i.type = type; i.value = value; return i;
}
function select(...options: string[]): HTMLSelectElement {
  const s = document.createElement("select");
  for (const o of options) { const e = document.createElement("option"); e.textContent = o; s.append(e); }
  return s;
}

if (!view3d) {
// 1. A document viewer: toolbar with menus, controls and a status line (md/csv/json/pdf use this).
{
  const root = document.createElement("div"); root.className = "va-viewer data-root";
  const bar = document.createElement("header");
  const toggle = button("편집");
  const save = menuButton("저장", "Ctrl+S"), copy = menuButton("다른 이름으로 저장…"), reload = menuButton("다시 읽기");
  documentBar(bar, {
    toggle, files: [save, copy, reload],
    view: [{ label: "찾기…", shortcut: "Ctrl+F", run: () => {} }],
    controls: [iconButton("이전 페이지", "previous"), iconButton("다음 페이지", "next"), iconButton("확대", "plus")],
  });
  const status = document.createElement("p"); status.className = "va-status"; status.setAttribute("role", "status"); status.textContent = "저장됨";
  const controls = row(button("기본"), button("주 버튼", { variant: "primary" }), button("위험", { variant: "danger" }), button("고스트", { variant: "ghost" }), button("비활성", { disabled: true }), iconButton("복사", "copy"), input("text", "입력칸"), select("UTF 자동", "한국어 CP949"), input("checkbox"), input("range"), input("number", "3"));
  root.append(bar, status, controls);
  section("문서 뷰어 도구줄 · 기본 버튼 · 입력", root);
  if (params.get("menu") === "open") bar.querySelector<HTMLButtonElement>(".va3d-menu-title")?.click();
}

// 2. Find bars: Markdown (icons), PDF (mixed), text (words).
{
  const md = document.createElement("div"); md.className = "md-root va-viewer";
  const find = createFind(document.createElement("article")); md.append(find.element); find.open();
  const pdfWrap = document.createElement("div"); pdfWrap.className = "va-viewer";
  const pdf = document.createElement("div"); pdf.className = "va-search";
  pdf.append(input("search", "정합"), button("이전 결과"), button("다음 결과"), iconButton("검색 닫기", "close"));
  pdfWrap.append(pdf);
  const text = document.createElement("div"); text.className = "text-root va-viewer";
  const tbar = document.createElement("div"); tbar.className = "text-search va-search";
  tbar.append(input("search", "dataclass"), button("이전"), button("다음"), button("닫기")); text.append(tbar);
  section("찾기 막대 (Markdown · PDF · 텍스트)", md, pdfWrap, text);
}

// 3. Markdown read mode: edit toggle, TOC toggle, read-only banner.
{
  const md = document.createElement("div"); md.className = "md-root va-viewer";
  const banner = document.createElement("div"); banner.className = "md-banner"; banner.textContent = "줄바꿈이 섞인 파일은 읽기 전용입니다.";
  md.append(row(button("편집", { cls: "md-mode-toggle" }), button("목차", { variant: "ghost", cls: "toc-toggle" })), banner);
  section("Markdown 편집 버튼 · 배너", md);
}

// 4. Text viewer bar and the empty window.
{
  const text = document.createElement("div"); text.className = "text-root va-viewer";
  const bar = document.createElement("header"); bar.className = "text-bar va-viewer-toolbar";
  bar.append(button("편집")); text.append(bar);
  const empty = document.createElement("div"); empty.className = "empty";
  const p = document.createElement("p"); p.textContent = "파일을 끌어다 놓거나 Ctrl+O";
  empty.append(p, button("텍스트로 열기… (Ctrl+Shift+O)"));
  section("텍스트 뷰어 도구줄 · 빈 창", text, empty);
}

}
// 5. 3D: floating toolbar, banner, point cloud panel controls.
if (view3d) {
  const scene = document.createElement("div"); scene.className = "va3d";
  const toolbar = buildToolbar(() => {});
  toolbar.append(select("Arcball", "Fly"), select("Z-up RH", "Y-up RH"), select("mm", "m"));
  const banner = document.createElement("div"); banner.className = "va3d-banner"; banner.setAttribute("role", "alert"); banner.style.top = "48px";
  const msg = document.createElement("span"); msg.textContent = "PNG로 저장했습니다";
  const close = iconButton("닫기", "close");
  banner.append(msg, button("정밀도를 낮춰 다시 시도", { cls: "va3d-banner-action" }), close);
  const cloud = document.createElement("div"); cloud.className = "va-cloud";
  cloud.style.position = "absolute"; cloud.style.left = "8px"; cloud.style.top = "120px"; cloud.style.width = "320px";
  cloud.append(row(button("3D 박스"), button("다각형 관통 선택"), button("작업 취소")), row(select("원본 RGB", "분류"), input("number", "0")));
  scene.append(toolbar, banner, cloud);
  section("3D 도구줄 · 배너 · 점군 패널", scene);
}

// 6. Update badge states.
{
  const holder = row();
  for (const status of [{ state: "latest" }, { state: "downloaded", version: "0.16.0" }, { state: "error" }]) {
    const before = new Set(document.querySelectorAll(".va-update"));
    updateBadge("0.15.0", () => {}, () => {})(status as never);
    for (const el of document.querySelectorAll(".va-update")) if (!before.has(el)) holder.append(el);
  }
  section("업데이트 배지", holder);
}

// Modal scenes on top of the page.
const scene = params.get("scene");
initializeDialogInput();
if (scene === "settings") void import("../settings/dialog").then((m) => m.openSettings());
if (scene === "dialog-discard") void showDialog({ message: "저장하지 않은 변경 내용을 버리고 닫을까요?", kind: "warning", buttons: [{ label: "닫기", value: "ok", variant: "danger" }, { label: "취소", value: "cancel" }], defaultValue: "cancel", cancelValue: "cancel" });
if (scene === "dialog-error") void showDialog({ message: "파일을 저장할 수 없습니다.", detail: "C:/Users/me/Documents/아주 긴 폴더 이름/그리고 더 긴 하위 폴더/report-final-v3.md: 액세스가 거부되었습니다. (os error 5)", kind: "error", buttons: [{ label: "확인", value: "ok", variant: "primary" }], defaultValue: "ok", cancelValue: "ok" });
if (scene === "restart" || scene === "restart-dirty") void confirmRestart(scene === "restart-dirty");
if (scene === "pdf-password") {
  // Same structure as src/pdf/viewer.ts.
  const dialog = document.createElement("dialog"); dialog.className = "va-dialog pdf-password";
  const form = document.createElement("form");
  const body = document.createElement("div"); body.className = "va-dialog-body";
  const title = document.createElement("h2"); title.className = "va-dialog-title"; title.textContent = "암호로 보호된 PDF";
  const label = document.createElement("label"); label.textContent = "PDF 암호를 입력하세요."; label.append(input("password"));
  const footer = document.createElement("div"); footer.className = "va-dialog-footer";
  const open = button("열기", { variant: "primary" }); open.type = "submit";
  footer.append(open, button("취소"));
  body.append(title, label); form.append(body, footer); dialog.append(form); document.body.append(dialog); dialog.showModal();
}
