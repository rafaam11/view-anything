import { test, expect } from "vitest";
import { createRunner, shouldConfirmLeave, planSave } from "../src/md/viewer-state";
import { splitFrontmatter, joinFrontmatter } from "../src/md/splice";

test("shouldConfirmLeave only when dirty", () => {
  expect(shouldConfirmLeave({ mode: "edit", dirty: true })).toBe(true);
  expect(shouldConfirmLeave({ mode: "edit", dirty: false })).toBe(false);
  expect(shouldConfirmLeave({ mode: "read", dirty: false })).toBe(false);
});

test("splitFrontmatter keeps yaml and its gap out of the editable body", () => {
  const md = "---\ntitle: x\n---\n\n# H\n\ntext\n";
  const { head, body } = splitFrontmatter(md);
  expect(head).toBe("---\ntitle: x\n---\n\n");
  expect(body).toBe("# H\n\ntext\n");
  expect(head + body).toBe(md);
});

test("splitFrontmatter without frontmatter returns the whole text as body", () => {
  expect(splitFrontmatter("# H\n")).toEqual({ head: "", body: "# H\n" });
  expect(splitFrontmatter("")).toEqual({ head: "", body: "" });
});

test("splitFrontmatter with frontmatter only", () => {
  expect(splitFrontmatter("---\na: 1\n---")).toEqual({ head: "---\na: 1\n---", body: "" });
});

test("joinFrontmatter adds a line break only when the head lacks one", () => {
  expect(joinFrontmatter("", "x\n")).toBe("x\n");
  expect(joinFrontmatter("---\na: 1\n---\n\n", "x\n")).toBe("---\na: 1\n---\n\nx\n");
  expect(joinFrontmatter("---\na: 1\n---", "x\n")).toBe("---\na: 1\n---\nx\n");
  expect(joinFrontmatter("---\na: 1\n---", "")).toBe("---\na: 1\n---");
});

const original = "---\ntitle: t\n---\n\n# Title\n\nfirst  para\n\n* keep   me\n";
// What an editor would emit for the body: normalized formatting.
const baseline = "# Title\n\nfirst  para\n\n- keep   me\n";

test("planSave: unchanged editor content writes nothing", () => {
  expect(planSave(original, baseline, baseline)).toEqual({ kind: "unchanged" });
});

test("planSave: splices only the edited block and keeps frontmatter bytes", () => {
  const edited = "# Title\n\nsecond para\n\n- keep   me\n";
  expect(planSave(original, baseline, edited)).toEqual({
    kind: "splice",
    text: "---\ntitle: t\n---\n\n# Title\n\nsecond para\n\n* keep   me\n",
  });
});

test("planSave: structure mismatch falls back to a full-rewrite proposal", () => {
  const badBaseline = "# Title\n\nfirst  para\n"; // one block short
  const edited = "# Title\n\nchanged\n";
  const plan = planSave(original, badBaseline, edited);
  expect(plan.kind).toBe("rewrite");
  if (plan.kind === "rewrite") {
    expect(plan.text).toBe("---\ntitle: t\n---\n\n# Title\n\nchanged\n");
    expect(plan.reason).toMatch(/block count mismatch/);
  }
});

test("planSave: structure mismatch with unchanged content still writes nothing", () => {
  const badBaseline = "# Title\n\nfirst  para\n";
  expect(planSave(original, badBaseline, badBaseline)).toEqual({ kind: "unchanged" });
});

// Task runner: one task at a time; user actions and saves are queued, background work is skipped.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("a user action during a background task runs after it instead of being dropped", async () => {
  const r = createRunner(() => {});
  const log: string[] = [];
  const bg = deferred();
  r.background(async () => {
    log.push("reload");
    await bg.promise;
    log.push("reload done");
  });
  expect(r.busy).toBe(true);
  r.user(async () => {
    log.push("toggle");
  });
  await tick();
  expect(log).toEqual(["reload"]);
  bg.resolve();
  await tick();
  await tick();
  expect(log).toEqual(["reload", "reload done", "toggle"]);
  expect(r.busy).toBe(false);
});

test("at most one user action is pending; background work is skipped while busy", async () => {
  const r = createRunner(() => {});
  const log: string[] = [];
  const first = deferred();
  r.user(async () => {
    await first.promise;
    log.push("a");
  });
  r.user(async () => void log.push("b"));
  r.user(async () => void log.push("c"));
  r.background(async () => void log.push("bg"));
  first.resolve();
  for (let i = 0; i < 5; i++) await tick();
  expect(log).toEqual(["a", "c"]);
});

test("a queued save runs before a queued user action and can be dropped", async () => {
  const r = createRunner(() => {});
  const log: string[] = [];
  const first = deferred();
  r.user(async () => {
    await first.promise;
    log.push("first");
  });
  r.user(async () => void log.push("toggle"));
  r.save(async () => void log.push("save"));
  first.resolve();
  for (let i = 0; i < 5; i++) await tick();
  expect(log).toEqual(["first", "save", "toggle"]);

  const again = deferred();
  r.save(async () => {
    await again.promise;
    r.dropQueuedSave(); // e.g. the user declined the overwrite dialog
    log.push("save1");
  });
  r.save(async () => void log.push("save2"));
  again.resolve();
  for (let i = 0; i < 5; i++) await tick();
  expect(log.slice(3)).toEqual(["save1"]);
});

test("errors are reported and do not block later tasks", async () => {
  const errors: unknown[] = [];
  const r = createRunner((e) => void errors.push(e));
  r.user(async () => {
    throw new Error("boom");
  });
  let ran = false;
  r.user(async () => void (ran = true));
  for (let i = 0; i < 5; i++) await tick();
  expect(errors.map(String)).toEqual(["Error: boom"]);
  expect(ran).toBe(true);
});
