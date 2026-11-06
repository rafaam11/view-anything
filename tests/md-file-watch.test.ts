// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { watchFile, type FileStamp } from "../src/md/file-watch";

let stamp: FileStamp;
let paused: boolean;
let alive: boolean;
const changed = vi.fn();
const stat = vi.fn(async () => stamp);
const start = () => watchFile({ stat, paused: () => paused, changed, alive: () => alive });
const setHidden = (value: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
};
/** The first round always sees the file as new: settle it, so the tests start from "unchanged". */
const started = async () => {
  const watch = start();
  await vi.advanceTimersByTimeAsync(1150);
  expect(changed).toHaveBeenCalledTimes(1);
  changed.mockClear();
  stat.mockClear();
  return watch;
};

beforeEach(() => {
  vi.useFakeTimers();
  stamp = { len: 1, modified_ms: 1 };
  paused = false;
  alive = true;
  changed.mockClear();
  stat.mockReset();
  stat.mockImplementation(async () => stamp);
});

afterEach(async () => {
  alive = false; // ends the watch at its next round
  await vi.advanceTimersByTimeAsync(2000);
  vi.useRealTimers();
  Reflect.deleteProperty(document, "hidden");
});

test("reports a change within a round and the settle wait, once", async () => {
  await started();
  stamp = { len: 2, modified_ms: 2 };
  await vi.advanceTimersByTimeAsync(1150);
  expect(changed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("a same-sized rewrite counts: the time changed", async () => {
  await started();
  stamp = { len: 1, modified_ms: 2 };
  await vi.advanceTimersByTimeAsync(1150);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("a file still being written is read only once it holds still", async () => {
  await started();
  stamp = { len: 2, modified_ms: 2 };
  await vi.advanceTimersByTimeAsync(1000); // round sees 2, waits for the settle
  stamp = { len: 3, modified_ms: 3 };
  await vi.advanceTimersByTimeAsync(150);
  expect(changed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1150);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("while paused the change stays unseen and is reported afterwards", async () => {
  await started();
  paused = true;
  stamp = { len: 2, modified_ms: 2 };
  await vi.advanceTimersByTimeAsync(3000);
  expect(changed).not.toHaveBeenCalled();
  expect(stat).not.toHaveBeenCalled();
  paused = false;
  await vi.advanceTimersByTimeAsync(1150);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("pausing during the settle wait does not lose the change", async () => {
  await started();
  stamp = { len: 2, modified_ms: 2 };
  await vi.advanceTimersByTimeAsync(1000);
  paused = true;
  await vi.advanceTimersByTimeAsync(150);
  expect(changed).not.toHaveBeenCalled();
  paused = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("a failing stat keeps the screen as it is and the watch running", async () => {
  await started();
  stat.mockImplementation(async () => { throw new Error("deleted"); });
  await vi.advanceTimersByTimeAsync(3000);
  expect(changed).not.toHaveBeenCalled();
  stat.mockImplementation(async () => ({ len: 5, modified_ms: 5 }));
  await vi.advanceTimersByTimeAsync(1150);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("retry reports the same stamp again after a failed read", async () => {
  const watch = await started();
  await vi.advanceTimersByTimeAsync(3000);
  expect(changed).not.toHaveBeenCalled();
  watch.retry();
  await vi.advanceTimersByTimeAsync(1150);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("rests while hidden and looks at once when shown again", async () => {
  await started();
  setHidden(true);
  stamp = { len: 2, modified_ms: 2 };
  await vi.advanceTimersByTimeAsync(5000);
  expect(stat).not.toHaveBeenCalled();
  setHidden(false);
  await vi.advanceTimersByTimeAsync(160); // far less than a round
  expect(changed).toHaveBeenCalledTimes(1);
});

test("rounds never overlap, however slow the stat is", async () => {
  await started();
  let inFlight = 0, most = 0;
  stat.mockImplementation(async () => {
    most = Math.max(most, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    inFlight--;
    return stamp;
  });
  await vi.advanceTimersByTimeAsync(20000);
  setHidden(true);
  setHidden(false);
  await vi.advanceTimersByTimeAsync(20000);
  expect(most).toBe(1);
});

test("stops by itself once the view is gone", async () => {
  await started();
  alive = false;
  await vi.advanceTimersByTimeAsync(5000);
  stat.mockClear();
  setHidden(true);
  setHidden(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(stat).not.toHaveBeenCalled();
});

test("kick runs a round at once instead of waiting for the timer", async () => {
  const watch = await started();
  stamp = { len: 2, modified_ms: 2 };
  watch.kick();
  await vi.advanceTimersByTimeAsync(160); // settle wait only, far less than a round
  expect(changed).toHaveBeenCalledTimes(1);
});

test("kick while a round is in flight does not overlap", async () => {
  const watch = await started();
  let inFlight = 0, most = 0;
  stat.mockImplementation(async () => {
    most = Math.max(most, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    inFlight--;
    return stamp;
  });
  await vi.advanceTimersByTimeAsync(1000); // a round starts
  watch.kick();
  watch.kick();
  await vi.advanceTimersByTimeAsync(10000);
  expect(most).toBe(1);
});
