import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "../platform";
import { approveUpdateUnload, updateDirty } from "./guard";
import { confirmRestart, updateBadge } from "./badge";
import { ATTEMPT_KEY, AUTO_KEY, failedAttempt, UpdateController, type UpdateStatus } from "./model";

interface Context { owner: string; startup: boolean; status: UpdateStatus; windows: string[] }
interface Probe { id: string; owner: string; phase: "prepare" | "commit" | "unlock" }
interface Ack { id: string; phase: Probe["phase"]; label: string; dirty: boolean; ok: boolean }
const UPDATE_EVENT = "va:check-update";

export async function startUpdater(): Promise<void> {
  const current = getCurrentWindow();
  const version = await getVersion();
  let owner = "";
  let active = false;
  let frozen: Probe | null = null;
  let activeProbe: Probe | null = null;
  let pending: { id: string; expected: Set<string>; dirty: boolean; resolve: (ok: boolean, dirty: boolean) => void } | null = null;
  let publishQueue = Promise.resolve();
  const request = (action: "check" | "install") => { void invoke("update_request", { action }).catch(() => render({ state: "error" })); };
  const render = updateBadge(version, request, (url) => { void platform.openExternal(url).catch(() => {}); });
  render({ state: "idle" });
  const context = () => invoke<Context>("update_context");
  function thaw() {
    frozen = null;
    document.getElementById("app")?.removeAttribute("inert");
    approveUpdateUnload(false);
  }
  // Capture before editor/app shortcuts while other windows await the restart decision.
  document.addEventListener("keydown", (event) => {
    if (frozen && !(event.target as Element | null)?.closest(".va-update-dialog")) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  await listen<Probe>("va-update-probe", async ({ payload }) => {
    if (payload.phase === "unlock") { if (frozen?.id === payload.id) thaw(); return; }
    let ok = true, dirty = false;
    try {
      if (payload.phase === "prepare") {
        frozen = payload;
        document.getElementById("app")?.setAttribute("inert", "");
        dirty = updateDirty();
      } else {
        ok = frozen?.id === payload.id;
        if (ok) approveUpdateUnload(true);
      }
    } catch { ok = false; }
    await emit("va-update-ack", { id: payload.id, phase: payload.phase, label: current.label, dirty, ok });
  });
  await listen<Ack>("va-update-ack", ({ payload }) => {
    if (!pending || `${payload.id}:${payload.phase}` !== pending.id || !pending.expected.has(payload.label)) return;
    pending.expected.delete(payload.label);
    pending.dirty ||= payload.dirty;
    if (!payload.ok) pending.resolve(false, pending.dirty);
    else if (pending.expected.size === 0) pending.resolve(true, pending.dirty);
  });
  async function round(probe: Probe, windows: string[]): Promise<{ ok: boolean; dirty: boolean }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false, false), 5000);
      const finish = (ok: boolean, dirty: boolean) => { clearTimeout(timer); pending = null; resolve({ ok, dirty }); };
      pending = { id: `${probe.id}:${probe.phase}`, expected: new Set(windows), dirty: false, resolve: finish };
      void emit("va-update-probe", probe).catch(() => finish(false, false));
    });
  }
  const controller = new UpdateController({
    check: async () => {
      const { check } = await import("@tauri-apps/plugin-updater");
      return check({ timeout: 30_000 });
    },
    publish: (status) => {
      render(status);
      publishQueue = publishQueue.then(() => invoke<void>("update_status", { status })).catch(() => {});
    },
    approve: async () => {
      const before = await context();
      if (before.owner !== current.label) return false;
      activeProbe = { id: crypto.randomUUID(), owner: current.label, phase: "prepare" };
      const prepared = await round(activeProbe, before.windows);
      if (!prepared.ok) return false;
      await current.setFocus();
      if (!await confirmRestart(prepared.dirty)) return false;
      const after = await context();
      if (after.owner !== current.label || [...after.windows].sort().join() !== [...before.windows].sort().join()) return false;
      // Phase-qualified acknowledgements cannot satisfy the wrong barrier.
      const committed = await round({ ...activeProbe, phase: "commit" }, after.windows);
      return committed.ok;
    },
    unlock: async () => {
      if (activeProbe) await emit("va-update-probe", { ...activeProbe, phase: "unlock" }).catch(() => {});
      activeProbe = null;
    },
    record: (to) => localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ from: version, to })),
    clearAttempt: () => { try { localStorage.removeItem(ATTEMPT_KEY); } catch { /* unavailable storage */ } },
    relaunch: async () => { const { relaunch } = await import("@tauri-apps/plugin-process"); await relaunch(); },
  });
  await listen<UpdateStatus>("va-update-status", ({ payload }) => render(payload));
  await listen<string>("va-update-request", async ({ payload }) => {
    const ctx = await context();
    if (ctx.owner !== current.label) return;
    if (payload === "check") await controller.check();
    if (payload === "install") await controller.install();
  });
  window.addEventListener(UPDATE_EVENT, () => request("check"));
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === "KeyU") {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) request("check");
    }
  }, true);
  let syncing = false;
  async function sync(): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      const ctx = await context();
      owner = ctx.owner;
      if (frozen && frozen.owner !== owner) thaw();
      if (owner !== current.label) { render(ctx.status); return; }
      if (active) return;
      active = true;
      let failed: string | null = null;
      let auto = true;
      try {
        auto = localStorage.getItem(AUTO_KEY) !== "false";
        if (ctx.startup) {
          failed = failedAttempt(localStorage.getItem(ATTEMPT_KEY), version);
          localStorage.removeItem(ATTEMPT_KEY);
        }
      } catch { /* defaults remain usable when storage is unavailable */ }
      if (failed) controller.set({ state: "installFailed", version: failed });
      else if (!import.meta.env.DEV && ((ctx.startup && auto) || ["checking", "available", "downloading", "downloaded"].includes(ctx.status.state))) {
        // A closed owner's native resource is gone: recover by checking/downloading again.
        void controller.check();
      } else controller.set(ctx.status);
    } catch { render({ state: "error" }); }
    finally { syncing = false; }
  }
  await sync();
  setInterval(() => { void sync(); }, 2000);
}
