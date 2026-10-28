import "./pointcloud.css";
import { Box3, BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, PointsMaterial, Vector3 } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { platform } from "../../platform";
import { registerUpdateGuard } from "../../update/guard";
import type { Stage } from "../core/stage";
import type { ViewTools } from "../core/view-tools";
import type { SceneFile } from "../core/scene-model";
import { disposeObject, type BuiltFile } from "../core/build-objects";
import { CloudClient, buildCloud } from "./client";
import { editedPath, type Action, type CloudDisplay, type CloudMeta, type Operation, type Region } from "./types";
import { pickCloud } from "./pick";

type History = { kind: "filter" } | { kind: "alignment"; before: Matrix4; after: Matrix4 };
interface Entry { meta: CloudMeta; path: string; display: CloudDisplay; size: number; alignment: Matrix4; savedAlignment: Matrix4; undo: History[]; redo: History[]; stale?: boolean }
export interface CloudHost {
  stage: Stage; tools: ViewTools;
  file(id: string): SceneFile | undefined;
  built(id: string): BuiltFile | undefined;
  replace(id: string, built: BuiltFile): Promise<void>;
  notice(text: string): void;
  unit(): string;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) { const e = document.createElement(tag); if (text) e.textContent = text; return e; }
export class CloudController {
  readonly entries = new Map<string, Entry>();
  readonly root = el("aside");
  private readonly body = el("fieldset");
  private readonly status = el("p");
  private readonly summary = el("p");
  private readonly choice = el("select");
  private readonly color = el("select");
  private readonly size = el("input");
  private readonly rangeMin = el("input");
  private readonly rangeMax = el("input");
  private readonly info = el("pre");
  private readonly client = new CloudClient();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly applyButton: HTMLButtonElement;
  private readonly rejectButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly editBody = el("fieldset");
  private readonly retry: HTMLButtonElement;
  private readonly targetChoice = el("select");
  private readonly registrationDistance = el("input");
  private readonly registrationSample = el("select");
  private readonly registrationButton: HTMLButtonElement;
  private readonly acceptRegistration: HTMLButtonElement;
  private readonly rejectRegistration: HTMLButtonElement;
  private registrationPreview: { id: string; target: string; before: Matrix4; after: Matrix4 } | null = null;
  private selected: string | null = null;
  private busy = false;
  private exportLocked = false;
  private approved = false;
  private cancelled = false;
  private buildAbort: AbortController | null = null;
  private committed = false;
  private mode: "none" | "point" | "box" | "polygon" = "none";
  private box: Mesh | null = null;
  private transform: TransformControls | null = null;
  private boxInputs: HTMLInputElement[] = [];
  private polygon: SVGSVGElement | null = null;
  private vertices: number[][] = [];

  constructor(private readonly host: CloudHost, parent: HTMLElement) {
    this.root.className = "va-cloud"; this.root.hidden = true; this.root.setAttribute("aria-label", "포인트클라우드");
    const title = el("strong", "포인트클라우드");
    this.choice.setAttribute("aria-label", "처리할 클라우드");
    this.choice.onchange = () => { if (this.isBusy() || this.registrationPreview) return; this.stopSelection(); this.selected = this.choice.value; this.sync(); };
    this.root.append(title, this.choice, this.summary, this.status, this.body);
    this.status.setAttribute("role", "status");
    const cancel = this.button("작업 취소", () => this.cancel()); cancel.dataset.cancel = "true"; this.body.before(cancel);
    this.retry = this.button("화면 다시 표시", () => void this.retryDisplay()); this.retry.hidden = true; this.body.before(this.retry);
    for (const [value, text] of [["rgb", "원본 RGB"], ["solid", "단색"], ["height", "높이"], ["intensity", "Intensity"]]) { const o = el("option", text); o.value = value; this.color.append(o); }
    this.label("색상", this.color); this.color.onchange = () => void this.changeDisplay();
    this.size.type = "range"; this.size.min = "1"; this.size.max = "10"; this.size.value = "2"; this.label("점 크기 (px)", this.size);
    this.size.oninput = () => { const e = this.entry(); if (!e || !this.selected) return; e.size = Number(this.size.value); this.host.built(this.selected)?.group.traverse((o) => { const material = (o as Mesh).material as PointsMaterial; if (material?.isPointsMaterial) { material.size = e.size; o.userData.vaPointSize = e.size; } }); this.host.stage.requestRender(); };
    for (const input of [this.rangeMin, this.rangeMax]) { input.type = "number"; input.step = "any"; }
    this.label("컬러맵 최소 (파랑)", this.rangeMin); this.label("컬러맵 최대 (빨강)", this.rangeMax);
    this.body.append(this.button("색상 범위 적용", () => void this.changeDisplay()));
    this.body.append(this.button("점 정보: 클릭", () => { this.stopSelection(); this.mode = "point"; this.status.textContent = "장면에서 보이는 점을 클릭하세요"; }));
    this.body.append(this.editBody);
    const selection = el("div");
    selection.append(this.button("3D 박스", () => this.startBox()), this.button("다각형 관통 선택", () => this.startPolygon()), this.button("선택 확정", () => void this.selectRegion()));
    selection.append(this.button("박스 이동", () => this.transform?.setMode("translate")), this.button("박스 크기", () => this.transform?.setMode("scale")));
    const coordinates = el("div"); coordinates.className = "va-cloud-box";
    for (let i = 0; i < 6; i++) { const input = el("input"); const caption = `${"XYZ"[i % 3]} ${i < 3 ? "최소" : "최대"}`; input.type = "number"; input.step = "any"; input.value = "0"; input.setAttribute("aria-label", caption); input.onchange = () => this.updateBox(); this.boxInputs.push(input); const label = el("label", caption); label.append(input); coordinates.append(label); }
    selection.append(coordinates, el("small", "박스 좌표는 화면 좌표계·표시 단위 기준. 다각형은 앞뒤 관통 선택. Esc: 취소."));
    selection.append(this.button("선택 부분 남기기", () => void this.act({ type: "crop", keep: true })), this.button("선택 부분 삭제", () => void this.act({ type: "crop", keep: false })), this.button("선택 해제", () => void this.act({ type: "clearSelection" })));
    this.editBody.append(selection);
    const voxel = this.number("복셀 크기 (원본 단위)", "", .000000001);
    this.editBody.append(this.button("Voxel 미리보기", () => void this.filter({ type: "voxel", size: voxel.valueAsNumber })));
    const k = this.number("SOR 이웃 수", "20", 1), sigma = this.number("SOR 표준편차 배수", "2", 0);
    this.editBody.append(this.button("SOR 미리보기", () => void this.filter({ type: "sor", k: k.valueAsNumber, sigma: sigma.valueAsNumber })));
    const radius = this.number("반경 (원본 단위)", "", .000000001), min = this.number("최소 이웃 수 (자신 제외)", "5", 1);
    this.editBody.append(this.button("반경 필터 미리보기", () => void this.filter({ type: "radius", radius: radius.valueAsNumber, min: min.valueAsNumber })));
    this.applyButton = this.button("결과 적용", () => void this.act({ type: "apply" })); this.rejectButton = this.button("미리보기 취소", () => void this.act({ type: "discardPreview" }));
    this.undoButton = this.button("실행 취소", () => void this.history("undo")); this.redoButton = this.button("다시 실행", () => void this.history("redo"));
    this.saveButton = this.button("다른 이름으로 저장…", () => void this.save());
    this.editBody.append(this.applyButton, this.rejectButton, this.undoButton, this.redoButton, this.saveButton);
    this.targetChoice.setAttribute("aria-label", "정합 기준 클라우드"); this.label("정합 기준", this.targetChoice);
    this.registrationDistance.type = "number"; this.registrationDistance.min = "0"; this.registrationDistance.step = "any"; this.registrationDistance.value = "1"; this.label("최대 대응 거리 (장면 단위)", this.registrationDistance);
    this.registrationSample.setAttribute("aria-label", "정합 최대 표본 수"); for (const n of [10000, 50000, 100000]) { const option = el("option", n.toLocaleString()); option.value = String(n); this.registrationSample.append(option); } this.registrationSample.value = "100000"; this.label("최대 표본 수", this.registrationSample);
    this.registrationButton = this.button("정합 미리보기", () => void this.register());
    this.acceptRegistration = this.button("정합 적용", () => this.finishRegistration(true));
    this.rejectRegistration = this.button("정합 취소", () => this.finishRegistration(false));
    this.body.append(this.registrationButton, this.acceptRegistration, this.rejectRegistration);
    this.body.append(this.info); parent.append(this.root);
    host.stage.canvas.addEventListener("pointerup", (event) => { if (this.mode === "point" && event.button === 0) { event.stopImmediatePropagation(); void this.inspect(event.clientX, event.clientY); } }, true);
    window.addEventListener("keydown", (e) => {
      if (!this.entries.size) return;
      if (e.key === "Escape" && this.mode !== "none") { e.preventDefault(); e.stopImmediatePropagation(); this.stopSelection(); }
      if ((e.target as HTMLElement)?.closest("input,select,textarea,[contenteditable]")) return;
      if (e.ctrlKey && e.code === "KeyS") { e.preventDefault(); void this.save(); }
      if (e.ctrlKey && e.code === "KeyZ") { e.preventDefault(); void this.history(e.shiftKey ? "redo" : "undo"); }
      if (e.ctrlKey && e.code === "KeyY") { e.preventDefault(); void this.history("redo"); }
    }, true);
    host.stage.onCameraChange(() => { if (this.mode === "polygon") this.stopSelection(); });
    window.addEventListener("resize", () => { if (this.mode === "polygon") this.stopSelection(); });
    registerUpdateGuard(() => this.dirty() || this.isBusy(), (approved) => { this.approved = approved; if (approved) this.cancel(); });
    void platform.onCloseRequested(async () => this.approved || (!(this.dirty() || this.isBusy())) || await platform.confirmDiscard("저장하지 않은 포인트클라우드 작업이 사라집니다. 닫을까요?"));
  }
  private button(text: string, run: () => void) { const b = el("button", text); b.type = "button"; b.onclick = run; return b; }
  private label(text: string, input: HTMLElement, parent: HTMLElement = this.body) { const l = el("label", text); l.append(input); parent.append(l); }
  private number(text: string, value: string, min: number) { const i = el("input"); i.type = "number"; i.step = "any"; i.min = String(min); i.value = value; this.label(text, i, this.editBody); return i; }
  private entry() { return this.selected ? this.entries.get(this.selected) : undefined; }
  dirty(): boolean { return !!this.registrationPreview || [...this.entries.values()].some((e) => e.meta.dirty || e.meta.preview || !e.alignment.equals(e.savedAlignment)); }
  hasRegistrationPreview(): boolean { return !!this.registrationPreview; }
  isBusy(): boolean { return this.busy || this.exportLocked; }
  lockExport(): boolean {
    if (this.isBusy() || this.registrationPreview || [...this.entries.values()].some((e) => e.stale || e.meta.preview)) return false;
    this.exportLocked = true; this.stopSelection(); this.sync(); return true;
  }
  unlockExport(): void { this.exportLocked = false; this.sync(); }
  cancel(): void { if (this.committed) { this.status.textContent = "완료된 결과를 표시 중입니다…"; return; } this.cancelled = true; this.client.cancel(); this.buildAbort?.abort(); this.status.textContent = "취소 요청됨…"; }
  select(id: string | null): void { if (this.isBusy() || this.registrationPreview) return; if (id && this.entries.has(id.split("/")[0])) { this.stopSelection(); this.selected = id.split("/")[0]; this.sync(); } }
  async canRemove(id: string): Promise<boolean> { const e = this.entries.get(id); if (!e) return true; if (this.isBusy() || this.registrationPreview) { this.host.notice("작업 또는 정합 미리보기를 끝낸 뒤 제거하세요."); return false; } const ok = !(e.meta.dirty || e.meta.preview || !e.alignment.equals(e.savedAlignment)) || await platform.confirmDiscard("저장하지 않은 포인트클라우드 변경을 버리고 제거할까요?"); return ok && !this.isBusy(); }
  remove(id: string): void { const e = this.entries.get(id); if (!e) return; if (this.selected === id) this.stopSelection(); this.entries.delete(id); void this.client.close(e.meta.id).catch(() => {}); if (this.selected === id) this.selected = this.entries.keys().next().value ?? null; this.sync(); }
  async open(id: string, path: string, signal: AbortSignal): Promise<BuiltFile | null> {
    if (this.isBusy() || this.registrationPreview) throw new Error("포인트클라우드 작업이 진행 중입니다");
    signal.throwIfAborted();
    this.busy = true; this.cancelled = false; this.sync(); this.root.hidden = false; this.body.disabled = true;
    const abort = () => this.cancel(); signal.addEventListener("abort", abort);
    let meta: CloudMeta | null = null;
    try {
      meta = await this.client.request({ type: "open", path }, undefined, (t) => this.status.textContent = t);
      if (!meta) return null;
      signal.throwIfAborted();
      if (this.cancelled) throw new DOMException("작업을 취소했습니다", "AbortError");
      this.buildAbort = new AbortController();
      const e: Entry = { meta, path, display: { mode: meta.hasRgb ? "rgb" : "solid", color: [180, 188, 198], height: [0, 0, 1, 0], range: [0, 1] }, size: 2, alignment: new Matrix4(), savedAlignment: new Matrix4(), undo: [], redo: [] };
      const built = await buildCloud(meta, id, e.display, 2, this.buildAbort.signal);
      if (signal.aborted || this.cancelled) { disposeObject(built.group); throw new DOMException("작업을 취소했습니다", "AbortError"); }
      this.entries.set(id, e); this.selected = id;
      this.status.textContent = "불러오기 완료";
      if (meta.warning) this.host.notice(meta.warning);
      if (meta.invalid) this.host.notice(`유효하지 않은 좌표 ${meta.invalid.toLocaleString()}개: 표시·계산에서 제외하며 정리 적용 시 저장 결과에서도 제외됩니다.`);
      return built;
    } catch (error) { if (meta) await this.client.close(meta.id).catch(() => {}); throw error; }
    finally { signal.removeEventListener("abort", abort); this.buildAbort = null; this.busy = false; this.sync(); }
  }
  private sync(): void {
    this.root.hidden = !this.entries.size && !this.busy; this.body.disabled = this.isBusy() || !!this.entry()?.stale; this.choice.disabled = this.isBusy();
    this.root.querySelector<HTMLButtonElement>("[data-cancel]")!.hidden = !this.busy;
    this.retry.hidden = !this.entry()?.stale; this.retry.disabled = this.isBusy();
    const options = [...this.entries].map(([id, e]) => { const o = el("option", (this.host.file(id)?.name ?? e.path.split(/[\\/]/).pop()!) + (e.meta.dirty ? " *" : "")); o.value = id; return o; });
    this.choice.replaceChildren(...options); this.choice.value = this.selected ?? ""; this.choice.disabled = this.isBusy() || !!this.registrationPreview;
    const target = this.targetChoice.value;
    this.targetChoice.replaceChildren(...[...this.entries].filter(([id]) => id !== this.selected).map(([id, item]) => { const o = el("option", this.host.file(id)?.name ?? item.path.split(/[\\/]/).pop()!); o.value = id; return o; }));
    if ([...this.targetChoice.options].some(o => o.value === target)) this.targetChoice.value = target;
    this.targetChoice.disabled = !!this.registrationPreview; this.registrationDistance.disabled = this.registrationSample.disabled = !!this.registrationPreview;
    this.color.disabled = !!this.registrationPreview; this.rangeMin.disabled = this.rangeMax.disabled = !!this.registrationPreview;
    this.registrationButton.disabled = !!this.registrationPreview || this.entries.size < 2;
    this.acceptRegistration.disabled = this.rejectRegistration.disabled = !this.registrationPreview;
    const e = this.entry(); if (!e) return;
    this.registrationButton.disabled ||= !e.meta.editable || e.meta.preview;
    this.color.value = e.display.mode; this.size.value = String(e.size); this.rangeMin.value = String(e.display.range[0]); this.rangeMax.value = String(e.display.range[1]);
    for (const o of this.color.options) o.disabled = (o.value === "rgb" && !e.meta.hasRgb) || (o.value === "intensity" && !e.meta.hasIntensity);
    this.summary.textContent = `${(e.meta.count - e.meta.invalid).toLocaleString()}점 · 선택 ${e.meta.selected.toLocaleString()} · ${e.meta.preview || this.registrationPreview ? "미리보기" : e.meta.dirty || !e.alignment.equals(e.savedAlignment) ? "미저장 작업본" : "저장됨"}`;
    this.editBody.disabled = !e.meta.editable || !!this.registrationPreview; this.undoButton.disabled = !e.undo.length || e.meta.preview; this.redoButton.disabled = !e.redo.length || e.meta.preview;
    this.applyButton.disabled = this.rejectButton.disabled = !e.meta.preview; this.saveButton.disabled = e.meta.preview;
  }
  private async rebuild(id: string, e: Entry): Promise<void> {
    this.buildAbort = new AbortController();
    e.stale = true;
    try {
      const built = await buildCloud(e.meta, id, e.display, e.size, this.buildAbort.signal);
      built.group.userData.vaBase = e.alignment.clone().multiply(new Matrix4().makeTranslation(...e.meta.origin)).toArray();
      if (!this.entries.has(id)) { disposeObject(built.group); return; }
      await this.host.replace(id, built); e.stale = false;
    } catch (error) {
      // The native revision already changed. Never expose the old picture as that result.
      const old = this.host.built(id); if (old) old.group.visible = false;
      this.host.stage.requestRender(); this.host.notice("화면 갱신 실패: 작업본은 보존되어 있습니다. ‘화면 다시 표시’를 누르세요."); throw error;
    } finally { this.buildAbort = null; }
  }
  private async retryDisplay(): Promise<void> {
    const id = this.selected, e = this.entry(); if (!id || !e || this.isBusy()) return;
    this.busy = true; this.committed = true; this.sync();
    try { await this.rebuild(id, e); this.status.textContent = "표시 복구 완료"; }
    catch (error) { this.status.textContent = String(error); }
    finally { this.busy = false; this.committed = false; this.sync(); }
  }
  private async act(action: Action): Promise<void> {
    const id = this.selected, e = this.entry(); if (!id || !e || this.isBusy() || e.stale || this.registrationPreview) return;
    if (e.meta.preview && !["apply", "discardPreview"].includes(action.type)) { this.host.notice("미리보기 결과를 먼저 적용하거나 취소하세요."); return; }
    this.stopSelection(); this.busy = true; this.cancelled = false; this.sync();
    try {
      const meta = await this.client.request(action, e.meta, (t) => this.status.textContent = t);
      if (!meta) throw new Error("세션 응답 누락"); e.meta = meta;
      this.committed = true;
      if (action.type === "apply") this.recordHistory(e, { kind: "filter" });
      if (action.type !== "save") await this.rebuild(id, e); else e.savedAlignment.copy(e.alignment);
      this.status.textContent = action.type === "save" ? "저장 완료" : "완료";
    } catch (error) { this.status.textContent = String(error); this.host.notice(String(error)); }
    finally { this.busy = false; this.committed = false; this.buildAbort = null; this.sync(); }
  }
  private recordHistory(e: Entry, item: History): void { e.undo.push(item); if (e.undo.length > 20) e.undo.shift(); e.redo = []; }
  private async history(direction: "undo" | "redo"): Promise<void> {
    const id = this.selected, e = this.entry(); if (!id || !e || this.isBusy() || e.stale || e.meta.preview || this.registrationPreview) return;
    const from = direction === "undo" ? e.undo : e.redo, to = direction === "undo" ? e.redo : e.undo, item = from[from.length - 1]; if (!item) return;
    let alignmentChanged = false;
    this.stopSelection(); this.busy = true; this.cancelled = false; this.sync();
    try {
      if (item.kind === "filter") {
        const meta = await this.client.request({ type: direction }, e.meta, (t) => this.status.textContent = t);
        if (!meta) throw new Error("세션 응답 누락"); e.meta = meta; this.committed = true;
        from.pop(); to.push(item); await this.rebuild(id, e);
      } else {
        const matrix = direction === "undo" ? item.before : item.after;
        this.setAlignment(id, matrix); e.alignment.copy(matrix); from.pop(); to.push(item); alignmentChanged = true;
      }
      this.status.textContent = direction === "undo" ? "실행 취소 완료" : "다시 실행 완료";
    } catch (error) { this.status.textContent = String(error); this.host.notice(String(error)); }
    finally { this.busy = false; this.committed = false; this.buildAbort = null; this.sync(); }
    if (alignmentChanged && e.display.mode === "height") await this.framesChanged(id);
  }
  private async filter(operation: Operation) { await this.act({ type: "filter", operation }); }
  private async save() {
    const e = this.entry(); if (!e || this.isBusy() || e.meta.preview || e.stale || !e.meta.editable || this.registrationPreview) return;
    this.busy = true; this.cancelled = false; this.sync();
    let action: Action | undefined;
    try {
      const ext = e.path.split(".").pop()!.toLowerCase();
      const path = await platform.saveDialog({ title: "포인트클라우드를 다른 이름으로 저장", defaultPath: editedPath(e.path), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (!path || this.cancelled) return;
      const exists = await platform.pathExists(path);
      if (exists && !await platform.confirmDanger("기존 저장 파일을 교체할까요? 원본 파일은 덮어쓸 수 없습니다.", "교체")) return;
      if (!this.cancelled) action = { type: "save", path, overwrite: exists, matrix: e.alignment.equals(new Matrix4()) ? undefined : e.alignment.toArray() };
    } catch (error) { this.host.notice(String(error)); }
    finally { this.busy = false; this.sync(); }
    if (action) await this.act(action);
  }
  private sourceToWorld(id = this.selected): Matrix4 | null { const e = id ? this.entries.get(id) : undefined, b = id ? this.host.built(id) : undefined; if (!e || !b) return null; b.group.updateWorldMatrix(true, false); return b.group.matrixWorld.clone().multiply(new Matrix4().makeTranslation(...e.meta.origin.map((x) => -x) as [number, number, number])); }
  private sourceToDisplay(): Matrix4 | null { const m = this.sourceToWorld(); return m && this.host.stage.displayToWorld.clone().invert().multiply(m); }
  private setAlignment(id: string, alignment: Matrix4): void {
    const entry = this.entries.get(id), file = this.host.file(id), built = this.host.built(id);
    if (!entry || !file || !built) throw new Error("정합할 클라우드가 없습니다");
    built.group.userData.vaBase = alignment.clone().multiply(new Matrix4().makeTranslation(...entry.meta.origin)).toArray();
    this.host.stage.setObjectFrame(built.group, { frame: file.sourceFrame, unit: file.sourceUnit });
    this.host.stage.requestRender();
  }
  private async register(): Promise<void> {
    const id = this.selected, source = this.entry(), targetId = this.targetChoice.value, target = this.entries.get(targetId);
    if (!id || !source || !target || id === targetId || this.isBusy() || this.registrationPreview || !source.meta.editable || source.stale || target.stale || source.meta.preview || target.meta.preview) return;
    const sourceWorld = this.sourceToWorld(id), targetWorld = this.sourceToWorld(targetId), distance = this.registrationDistance.valueAsNumber;
    if (!sourceWorld || !targetWorld || !Number.isFinite(distance) || distance <= 0) { this.host.notice("대응 거리를 확인하세요"); return; }
    const base = sourceWorld.clone().multiply(source.alignment.clone().invert());
    if (!Number.isFinite(base.determinant()) || Math.abs(base.determinant()) < 1e-18) { this.host.notice("원본 좌표계를 역변환할 수 없습니다"); return; }
    this.stopSelection(); this.busy = true; this.cancelled = false; this.sync();
    try {
      const result = await this.client.register(source.meta, sourceWorld.toArray(), target.meta, targetWorld.toArray(), distance, Number(this.registrationSample.value), t => this.status.textContent = t);
      if (!this.entries.has(id) || !this.entries.has(targetId)) throw new Error("클라우드가 제거되었습니다");
      const after = base.clone().invert().multiply(new Matrix4().fromArray(result.matrix)).multiply(base).multiply(source.alignment);
      if (!after.elements.every(Number.isFinite)) throw new Error("정합 변환이 유효하지 않습니다");
      this.setAlignment(id, after);
      this.registrationPreview = { id, target: targetId, before: source.alignment.clone(), after };
      this.status.textContent = `정합 미리보기: 대응 ${result.pairs.toLocaleString()}/${result.sampledSource.toLocaleString()}점 (${(result.fitness * 100).toFixed(1)}%), 기준 표본 ${result.sampledTarget.toLocaleString()}점, RMSE ${result.rmse.toPrecision(4)}, ${result.iterations}회, ${result.converged ? "수렴" : "반복 한도 도달"}`;
    } catch (error) { this.status.textContent = String(error); this.host.notice(String(error)); }
    finally { this.busy = false; this.sync(); }
  }
  private finishRegistration(accept: boolean): void {
    const preview = this.registrationPreview; if (!preview || this.isBusy()) return;
    const entry = this.entries.get(preview.id); if (!entry) return;
    try {
      if (accept) { entry.alignment.copy(preview.after); this.recordHistory(entry, { kind: "alignment", before: preview.before.clone(), after: preview.after.clone() }); } else this.setAlignment(preview.id, preview.before);
      this.registrationPreview = null; this.status.textContent = accept ? "정합을 적용했습니다. 다른 이름으로 저장하세요." : "정합을 취소했습니다.";
      if (accept && entry.display.mode === "height") void this.framesChanged(preview.id);
    } catch (error) { this.host.notice(String(error)); }
    this.sync();
  }
  private async changeDisplay() {
    const id = this.selected, e = this.entry(); if (!id || !e || this.isBusy() || e.stale || this.registrationPreview) return;
    const mode = this.color.value as CloudDisplay["mode"];
    const minInput = this.rangeMin.valueAsNumber, maxInput = this.rangeMax.valueAsNumber;
    this.busy = true; this.committed = true; this.sync();
    try {
      this.rangeMin.value = String(minInput); this.rangeMax.value = String(maxInput);
      const matrix = this.sourceToDisplay();
      if (mode === "height" && matrix) {
        // Display presets can be Y-up; world +Y is always the displayed up direction.
        const world = this.sourceToWorld()!.elements; e.display.height = [world[1], world[5], world[9], world[13]];
        if (e.display.mode !== mode) { const b = e.meta.bounds, values: number[] = []; for (let i = 0; i < 8; i++) values.push(e.display.height[3] + [0, 1, 2].reduce((v, a) => v + b[a + ((i >> a) & 1) * 3] * e.display.height[a], 0)); this.rangeMin.value = String(Math.min(...values)); this.rangeMax.value = String(Math.max(...values)); }
      }
      const min = this.rangeMin.valueAsNumber, max = this.rangeMax.valueAsNumber;
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error("색상 범위를 확인하세요");
      e.display = { ...e.display, mode, range: [min, max] }; await this.rebuild(id, e);
    } catch (error) { this.host.notice(String(error)); }
    finally { this.busy = false; this.committed = false; this.sync(); }
  }
  async framesChanged(fileId?: string): Promise<void> {
    this.stopSelection(); this.info.textContent = "";
    this.busy = true; this.committed = true; this.sync();
    try {
      for (const [id, e] of this.entries) {
        if ((fileId && id !== fileId) || e.display.mode !== "height") continue;
        const world = this.sourceToWorld(id)?.elements; if (!world) continue;
        e.display.height = [world[1], world[5], world[9], world[13]];
        const values = Array.from({ length: 8 }, (_, i) => e.display.height[3] + [0, 1, 2].reduce((v, a) => v + e.meta.bounds[a + ((i >> a) & 1) * 3] * e.display.height[a], 0));
        e.display.range = [Math.min(...values), Math.max(...values)];
        try { await this.rebuild(id, e); } catch (error) { this.status.textContent = String(error); }
      }
    } finally { this.busy = false; this.committed = false; this.sync(); }
  }
  private startBox() {
    const e = this.entry(), m = this.sourceToDisplay(); if (!e || !m || this.isBusy() || e.stale) return;
    this.stopSelection(); this.mode = "box";
    const b = new Box3(new Vector3(...e.meta.bounds.slice(0, 3)), new Vector3(...e.meta.bounds.slice(3))).applyMatrix4(m);
    [...b.min.toArray(), ...b.max.toArray()].forEach((v, i) => this.boxInputs[i].value = String(v));
    this.box = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffad24, wireframe: true, depthTest: false }));
    this.host.stage.overlay.add(this.box); this.updateBox();
    this.transform = new TransformControls(this.host.stage.camera, this.host.stage.canvas); this.transform.setSpace("local"); this.transform.setMode("scale"); this.transform.attach(this.box);
    this.host.stage.scene.add(this.transform.getHelper());
    this.transform.addEventListener("dragging-changed", (event) => { this.host.stage.controls.enabled = !event.value; });
    this.transform.addEventListener("objectChange", () => { if (!this.box) return; const p = this.box.position, s = this.box.scale; for (let a = 0; a < 3; a++) { this.boxInputs[a].value = String(p.getComponent(a) - Math.abs(s.getComponent(a)) / 2); this.boxInputs[a + 3].value = String(p.getComponent(a) + Math.abs(s.getComponent(a)) / 2); } this.host.stage.requestRender(); });
    this.transform.addEventListener("change", () => this.host.stage.requestRender());
    this.status.textContent = `박스 핸들 또는 최소/최대 수치 조절 (${this.host.unit()}) → 선택 확정`;
  }
  private updateBox() { if (!this.box) return; const a = this.boxInputs.map((i) => i.valueAsNumber); if (a.some((v) => !Number.isFinite(v))) return; for (let k = 0; k < 3; k++) { this.box.position.setComponent(k, (a[k] + a[k + 3]) / 2); this.box.scale.setComponent(k, Math.max(Math.abs(a[k + 3] - a[k]), 1e-12)); } this.host.stage.requestRender(); }
  private startPolygon() {
    if (this.isBusy() || !this.entry() || this.entry()?.stale) return; this.stopSelection(); this.mode = "polygon"; this.vertices = []; this.host.stage.controls.enabled = false;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add("va-cloud-polygon");
    const line = document.createElementNS(svg.namespaceURI, "polyline"); svg.append(line); this.host.stage.canvas.parentElement!.append(svg); this.polygon = svg;
    svg.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); if (event.button !== 0 || this.vertices.length >= 4096) return; const r = svg.getBoundingClientRect(); this.vertices.push([(event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2]); line.setAttribute("points", this.vertices.map(([x, y]) => `${(x + 1) / 2 * r.width},${(1 - y) / 2 * r.height}`).join(" ")); });
    this.status.textContent = "영역 꼭짓점을 클릭한 뒤 선택 확정 (앞뒤 관통, Esc 취소)";
  }
  private async selectRegion() {
    let region: Region, matrix: Matrix4 | null;
    if (this.mode === "box") { region = { type: "box", min: this.boxInputs.slice(0, 3).map((i) => i.valueAsNumber), max: this.boxInputs.slice(3).map((i) => i.valueAsNumber) }; matrix = this.sourceToDisplay(); }
    else if (this.mode === "polygon") { region = { type: "polygon", vertices: this.vertices }; matrix = this.sourceToWorld(); if (matrix) matrix.premultiply(this.host.stage.camera.matrixWorldInverse).premultiply(this.host.stage.camera.projectionMatrix); }
    else return;
    const world = this.sourceToWorld(); if (!matrix || !world) return;
    const planes = this.host.tools.clipper.planes.map((p) => { const v = p.clone().applyMatrix4(world.clone().invert()); return [...v.normal.toArray(), v.constant]; });
    await this.filter({ type: "select", matrix: matrix.toArray(), planes, region });
  }
  private stopSelection() { this.mode = "none"; this.polygon?.remove(); this.polygon = null; this.vertices = []; if (this.transform) { this.host.stage.scene.remove(this.transform.getHelper()); this.transform.detach(); this.transform.dispose(); this.transform = null; } if (this.box) { this.box.removeFromParent(); disposeObject(this.box); this.box = null; } this.host.stage.controls.enabled = true; this.host.stage.requestRender(); }
  private async inspect(x: number, y: number) {
    const selected = this.selected, e = this.entry(), b = selected ? this.host.built(selected) : undefined; if (!e || !b || this.isBusy() || e.stale) return;
    const revision = e.meta.revision, matrix = this.sourceToDisplay(); if (!matrix) return;
    try { const id = pickCloud(this.host.stage, b.group, x, y, this.host.tools.clipper.planes); if (id === null) { this.info.textContent = "보이는 점이 없습니다"; return; }
      const p = await this.client.point(e.meta.id, id); if (this.selected !== selected || e.meta.revision !== revision || this.mode !== "point") return;
      const display = new Vector3(...p.position).applyMatrix4(matrix);
      this.info.textContent = `점 #${p.id}\n원본: ${p.position.join(", ")}\n화면: ${display.toArray().join(", ")}\n` + Object.entries(p.fields).map(([name, v]) => `${name}: ${v.values.join(", ")}${v.count > v.values.length ? ` … (${v.count}개)` : ""}`).join("\n");
    } catch (error) { this.host.notice(String(error)); }
  }
}
