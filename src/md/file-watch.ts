export interface FileStamp { len: number; modified_ms: number | null }

export interface FileWatchOptions {
  stat(): Promise<FileStamp>;
  /** While true the change stays unseen, so it is picked up on a later round. */
  paused(): boolean;
  changed(): void;
  /** False once the view is gone; the watch then ends by itself. */
  alive(): boolean;
  intervalMs?: number;
  settleMs?: number;
}

/**
 * Polls by path: unlike a native watcher this also follows atomic replaces and network or synced
 * folders, and needs no per-window lifetime handling. Rounds never overlap.
 */
export function watchFile(options: FileWatchOptions): { retry(): void } {
  const { intervalMs = 1000, settleMs = 150 } = options;
  const key = (s: FileStamp) => `${s.len}:${s.modified_ms}`;
  let last: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const check = async () => {
    if (options.paused()) return;
    const seen = key(await options.stat());
    if (seen === last) return;
    // A file still being written changes again within this wait; read it once it holds still.
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    if (key(await options.stat()) !== seen || options.paused()) return;
    last = seen;
    options.changed();
  };
  const round = async () => {
    if (!options.alive()) { document.removeEventListener("visibilitychange", onVisibility); return; }
    if (!document.hidden) {
      running = true;
      // A file that cannot be stat'ed right now (deleted, locked) keeps what is on screen.
      await check().catch(() => {});
      running = false;
    }
    timer = setTimeout(round, intervalMs);
  };
  const onVisibility = () => {
    if (document.hidden || running) return;
    clearTimeout(timer);
    void round();
  };
  document.addEventListener("visibilitychange", onVisibility);
  timer = setTimeout(round, intervalMs);
  return {
    /** The change could not be read after all; see it as new on the next round. */
    retry() { last = null; },
  };
}
