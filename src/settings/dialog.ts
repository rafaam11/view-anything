import "./settings.css";
import { preferences, applyPreferences, DEFAULTS, FONTS, type FontPreset, type Preferences } from "./preferences";
import { textSettings, settingsContext } from "./document";
import { applyTheme, type ThemeMode } from "../theme";

let dialog: HTMLDialogElement | null = null;
export function openSettings(): void {
  if (dialog?.isConnected) { if (!dialog.open) dialog.showModal(); return; }
  const previous = document.activeElement as HTMLElement | null;
  const d = document.createElement("dialog"); dialog = d; d.className = "va-settings";
  d.setAttribute("aria-labelledby", "va-settings-title");
  const title = document.createElement("h2"); title.id = "va-settings-title"; title.textContent = "설정"; d.append(title);
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const group = (name: string) => {
    const field = document.createElement("fieldset"), legend = document.createElement("legend");
    legend.textContent = name; field.append(legend); d.append(field); return field;
  };
  const label = (field: HTMLElement, text: string, control: HTMLElement) => {
    control.setAttribute("aria-label", text);
    const l = document.createElement("label"); l.append(document.createTextNode(text), control); field.append(l);
  };
  const select = (values: [string, string][]) => {
    const control = document.createElement("select");
    for (const [value, name] of values) { const option = document.createElement("option"); option.value = value; option.textContent = name; control.append(option); }
    return control;
  };
  const save = (p: Partial<Preferences>) => {
    status.textContent = applyPreferences(p) ? "" : "설정을 저장할 수 없습니다. 이 창에만 적용됩니다.";
  };
  const general = group("일반"), theme = select([["system", "시스템 설정"], ["light", "라이트"], ["dark", "다크"]]);
  label(general, "테마", theme);
  const syncTheme = () => { theme.value = document.documentElement.dataset.theme ?? "system"; };
  theme.onchange = () => applyTheme(theme.value as ThemeMode); syncTheme();
  const syncers: (() => void)[] = [];
  const display = (kind: "markdown" | "text") => {
    const isText = kind === "text", name = isText ? "텍스트" : "Markdown", field = group(name);
    const font = select([["system", "시스템 기본"], ["serif", "명조 계열"], ["mono", "고정폭 계열"]]);
    const size = document.createElement("input"); size.type = "number"; size.min = "12"; size.max = "24"; size.step = "1";
    label(field, "본문 글꼴", font); label(field, "본문 글자 크기 (px)", size);
    const wrap = document.createElement("input"); wrap.type = "checkbox";
    if (isText) label(field, "자동 줄바꿈", wrap);
    const preview = document.createElement("p"); preview.className = "va-settings-preview"; preview.textContent = `가나다 ABC 123 · ${name} 미리보기`; field.append(preview);
    const sync = () => {
      const p = preferences(), f = isText ? p.textFont : p.mdFont, s = isText ? p.textSize : p.mdSize;
      font.value = f; size.value = String(s); wrap.checked = p.textWrap;
      preview.style.fontFamily = FONTS[f]; preview.style.fontSize = `${s}px`;
    };
    const update = () => {
      if (!size.checkValidity() || !size.value) { status.textContent = "글자 크기는 12~24px의 정수로 입력하세요."; return; }
      save(isText ? { textFont: font.value as FontPreset, textSize: Number(size.value), textWrap: wrap.checked } : { mdFont: font.value as FontPreset, mdSize: Number(size.value) });
    };
    font.onchange = size.onchange = update;
    wrap.onchange = () => save({ textWrap: wrap.checked });
    const reset = document.createElement("button"); reset.textContent = "기본값 복원"; reset.setAttribute("aria-label", `${name} 기본값 복원`);
    reset.onclick = () => save(isText ? { textFont: DEFAULTS.textFont, textSize: DEFAULTS.textSize, textWrap: DEFAULTS.textWrap } : { mdFont: DEFAULTS.mdFont, mdSize: DEFAULTS.mdSize });
    field.append(reset); syncers.push(sync); sync();
  };
  const context = settingsContext();
  if (context === "markdown" || context === "empty") display("markdown");
  if (context === "text" || context === "empty") display("text");
  const documentOptions = textSettings();
  if (documentOptions && context === "text") {
    const field = group("현재 파일"), encoding = select([["utf", "UTF 자동"], ["cp949", "한국어 CP949"]]);
    encoding.value = documentOptions.encoding(); label(field, "문자 인코딩", encoding);
    encoding.onchange = () => {
      encoding.disabled = true;
      void documentOptions.changeEncoding(encoding.value === "cp949" ? "cp949" : "utf")
        .catch(e => { status.textContent = String(e); })
        .finally(() => { encoding.value = documentOptions.encoding(); encoding.disabled = false; });
    };
  }
  const close = document.createElement("button"); close.textContent = "닫기"; close.onclick = () => d.close();
  d.append(status, close); document.body.append(d);
  const sync = () => { for (const fn of syncers) fn(); };
  const onStorage = (e: StorageEvent) => { if (e.key === "va.theme" || e.key === null) syncTheme(); };
  const onContext = () => d.close();
  window.addEventListener("va:preferences", sync); window.addEventListener("storage", onStorage); window.addEventListener("va:settings-context", onContext);
  d.addEventListener("close", () => {
    window.removeEventListener("va:preferences", sync); window.removeEventListener("storage", onStorage); window.removeEventListener("va:settings-context", onContext);
    d.remove(); dialog = null; previous?.focus();
  }, { once: true });
  d.showModal();
}
