import "./settings.css";
import { preferences, applyPreferences, DEFAULTS, type FontPreset } from "./preferences";
let dialog: HTMLDialogElement | null = null;
export function openSettings(): void {
  if (dialog?.isConnected) { if (!dialog.open) dialog.showModal(); return; }
  const previous = document.activeElement as HTMLElement | null;
  const d = document.createElement("dialog"); dialog = d; d.className = "va-settings";
  d.setAttribute("aria-labelledby", "va-settings-title");
  const title = document.createElement("h2"); title.id = "va-settings-title"; title.textContent = "설정";
  const group = document.createElement("fieldset"); const legend = document.createElement("legend"); legend.textContent = "Markdown"; group.append(legend);
  const font = document.createElement("select");
  for (const [value, name] of [["system", "시스템 기본"], ["serif", "명조 계열"], ["mono", "고정폭 계열"]]) {
    const o = document.createElement("option"); o.value = value; o.textContent = name; font.append(o);
  }
  const size = document.createElement("input"); size.type = "number"; size.min = "12"; size.max = "24"; size.step = "1";
  for (const [text, input] of [["본문 글꼴", font], ["본문 글자 크기 (px)", size]] as const) {
    const label = document.createElement("label"); label.append(document.createTextNode(text), input); group.append(label);
  }
  const preview = document.createElement("p"); preview.className = "va-settings-preview"; preview.textContent = "가나다 ABC 123 · Markdown 미리보기";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const sync = () => { const p = preferences(); font.value = p.mdFont; size.value = String(p.mdSize); };
  const update = () => {
    if (!size.checkValidity() || !size.value) { status.textContent = "글자 크기는 12~24px의 정수로 입력하세요."; return; }
    status.textContent = applyPreferences({ mdFont: font.value as FontPreset, mdSize: Number(size.value) }) ? "" : "설정을 저장할 수 없습니다. 이 창에만 적용됩니다.";
  };
  font.onchange = size.onchange = update;
  const reset = document.createElement("button"); reset.textContent = "기본값 복원";
  reset.onclick = () => { status.textContent = applyPreferences(DEFAULTS) ? "" : "설정을 저장할 수 없습니다. 이 창에만 적용됩니다."; sync(); };
  const close = document.createElement("button"); close.textContent = "닫기"; close.onclick = () => d.close();
  d.append(title, group, preview, status, reset, close); document.body.append(d); sync();
  window.addEventListener("va:preferences", sync);
  d.addEventListener("close", () => { window.removeEventListener("va:preferences", sync); d.remove(); dialog = null; previous?.focus(); }, { once: true });
  d.showModal();
}
