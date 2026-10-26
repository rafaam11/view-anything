import { test, expect } from "vitest";
import { shouldConfirmLeave, planSave } from "../src/md/viewer-state";
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
