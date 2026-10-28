export type UpdateStatus =
  | { state: "idle" | "checking" | "latest" | "error" }
  | { state: "available" | "downloaded" | "installing" | "installFailed"; version: string }
  | { state: "downloading"; version: string; percent: number };
export const AUTO_KEY = "va.update.autoCheck";
export const ATTEMPT_KEY = "va.update.attempt";
export const RELEASES = "https://github.com/rafaam11/view-anything/releases";
export const REPOSITORY = "https://github.com/rafaam11/view-anything";
export function statusLabel(status: UpdateStatus, current: string): string {
  switch (status.state) {
    case "idle": return `v${current}`;
    case "checking": return "업데이트 확인 중";
    case "available": return `${status.version} 업데이트 가능`;
    case "downloading": return `다운로드 중 ${status.percent}%`;
    case "downloaded": return `${status.version} 업데이트 설치 준비 완료`;
    case "installing": return `${status.version} 업데이트 설치 중`;
    case "installFailed": return `${status.version} 설치 실패`;
    case "error": return "업데이트 확인 실패";
    case "latest": return "최신 버전";
  }
}
export function failedAttempt(raw: string | null, current: string): string | null {
  try {
    const v = JSON.parse(raw ?? "null");
    return v && typeof v.from === "string" && typeof v.to === "string" && v.from !== v.to && v.from === current ? v.to : null;
  } catch { return null; }
}
export interface DownloadProgress { event: "Started" | "Progress" | "Finished"; data?: { contentLength?: number; chunkLength?: number } }
export interface UpdateHandle {
  version: string;
  download(progress: (event: DownloadProgress) => void): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}
export interface UpdateDependencies {
  check(): Promise<UpdateHandle | null>;
  publish(status: UpdateStatus): void;
  approve(): Promise<boolean>;
  unlock(): Promise<void>;
  record(version: string): void;
  clearAttempt(): void;
  relaunch(): Promise<void>;
}
/** Only the owner holds a native update resource; requests never overlap. */
export class UpdateController {
  private handle: UpdateHandle | null = null;
  private busy = false;
  status: UpdateStatus = { state: "idle" };
  constructor(private readonly deps: UpdateDependencies) {}
  set(status: UpdateStatus): void { this.status = status; this.deps.publish(status); }
  async check(): Promise<void> {
    if (this.busy || this.status.state === "downloaded") return;
    this.busy = true;
    try {
      await this.handle?.close();
      this.handle = null;
      this.set({ state: "checking" });
      this.handle = await this.deps.check();
      if (!this.handle) { this.set({ state: "latest" }); return; }
      const version = this.handle.version;
      this.set({ state: "available", version });
      let total = 0, loaded = 0, last = -1;
      await this.handle.download((event) => {
        if (event.event === "Started") total = event.data?.contentLength ?? 0;
        if (event.event === "Progress") loaded += event.data?.chunkLength ?? 0;
        const percent = event.event === "Finished" ? 100 : total > 0 ? Math.min(99, Math.floor(loaded * 100 / total)) : 0;
        if (percent !== last) { last = percent; this.set({ state: "downloading", version, percent }); }
      });
      this.set({ state: "downloaded", version });
    } catch {
      await this.handle?.close().catch(() => {});
      this.handle = null;
      this.set({ state: "error" });
    } finally { this.busy = false; }
  }
  async install(): Promise<void> {
    if (this.busy || !this.handle || this.status.state !== "downloaded") return;
    this.busy = true;
    const version = this.handle.version;
    try {
      if (!await this.deps.approve()) return;
      this.deps.record(version);
      this.set({ state: "installing", version });
      await this.handle.install();
      await this.deps.relaunch();
    } catch {
      try { this.deps.clearAttempt(); } catch { /* storage may be unavailable */ }
      this.set({ state: "installFailed", version });
    } finally {
      try { await this.deps.unlock(); } catch { /* a closed window may no longer receive unlock */ }
      finally { this.busy = false; }
    }
  }
}
