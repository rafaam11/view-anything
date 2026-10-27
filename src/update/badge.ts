import { AUTO_KEY, RELEASES, REPOSITORY, statusLabel, type UpdateStatus } from "./model";
import "./update.css";

export function updateBadge(version: string, request: (action: "check" | "install") => void, open: (url: string) => void) {
  const root = document.createElement("aside");
  root.className = "va-update";
  root.setAttribute("aria-label", "앱 업데이트");
  const chip = document.createElement("button");
  chip.setAttribute("aria-haspopup", "true");
  const action = document.createElement("button");
  const menu = document.createElement("div");
  menu.className = "va-update-menu";
  menu.hidden = true;
  function close() { menu.hidden = true; chip.setAttribute("aria-expanded", "false"); }
  function item(label: string, run: () => void) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => { close(); run(); };
    menu.append(b);
  }
  item("업데이트 확인", () => request("check"));
  item("릴리스 노트", () => open(RELEASES));
  item("GitHub 저장소", () => open(REPOSITORY));
  const v = document.createElement("span");
  v.textContent = `버전 v${version}`;
  menu.append(v);
  const label = document.createElement("label");
  const auto = document.createElement("input");
  auto.type = "checkbox";
  const sync = () => { try { auto.checked = localStorage.getItem(AUTO_KEY) !== "false"; } catch { auto.checked = true; } };
  sync();
  auto.onchange = () => { try { localStorage.setItem(AUTO_KEY, String(auto.checked)); } catch { sync(); } };
  label.append(auto, "시작 시 업데이트 자동 확인");
  menu.append(label);
  chip.onclick = () => { sync(); menu.hidden = !menu.hidden; chip.setAttribute("aria-expanded", String(!menu.hidden)); };
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); chip.focus(); } });
  document.addEventListener("pointerdown", (e) => { if (!root.contains(e.target as Node)) close(); });
  root.append(chip, action, menu);
  document.body.append(root);
  return (status: UpdateStatus) => {
    chip.textContent = statusLabel(status, version);
    root.dataset.state = status.state;
    action.hidden = true;
    if (status.state === "downloaded") {
      action.textContent = "재시작";
      action.title = "업데이트를 설치하려면 앱을 재시작하세요";
      action.onclick = () => request("install");
    } else if (status.state === "installFailed") {
      action.textContent = "수동 설치";
      action.title = "자동 설치가 적용되지 않았습니다 — 릴리스 페이지에서 설치 파일을 받아 실행하세요";
      action.onclick = () => open(RELEASES);
    } else if (status.state === "error") {
      action.textContent = "릴리스";
      action.title = "릴리스 페이지 열기";
      action.onclick = () => open(RELEASES);
    } else if (status.state === "latest") {
      action.textContent = "확인";
      action.title = "업데이트 확인";
      action.onclick = () => request("check");
    } else return;
    action.hidden = false;
  };
}

/** Safe default on both platforms, independent of native dialog button ordering. */
export function confirmRestart(dirty: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "va-update-dialog";
    const heading = document.createElement("h2");
    heading.textContent = "업데이트 설치";
    const text = document.createElement("p");
    text.textContent = "지금 재시작하여 업데이트를 설치할까요?";
    const warning = document.createElement("p");
    warning.textContent = dirty ? "저장하지 않은 변경과 진행 중인 작업은 사라집니다. 저장하려면 취소하세요." : "";
    const cancel = document.createElement("button");
    cancel.textContent = "취소";
    cancel.autofocus = true;
    const restart = document.createElement("button");
    restart.textContent = "재시작";
    const finish = (ok: boolean) => { dialog.close(); dialog.remove(); resolve(ok); };
    cancel.onclick = () => finish(false);
    restart.onclick = () => finish(true);
    dialog.oncancel = (e) => { e.preventDefault(); finish(false); };
    dialog.append(heading, text, warning, cancel, restart);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
