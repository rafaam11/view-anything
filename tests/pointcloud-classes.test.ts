import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { CLASSES } from "../src/three/cloud/classes";

test("the ASPRS class table lists codes 0-18 with Korean names", () => {
  expect(CLASSES.map((c) => c.code)).toEqual(Array.from({ length: 19 }, (_, i) => i));
  expect(CLASSES[2]).toMatchObject({ code: 2, name: "지면", rgb: [139, 90, 43] });
});

test("the legend colours match the Rust palette that paints the points", () => {
  const rust = readFileSync("src-tauri/src/cloud/session.rs", "utf8");
  const body = /fn classification_color\(code: u8\) -> \[u8; 3\] \{([\s\S]*?)\r?\n\}/.exec(rust)![1];
  const arms = new Map([...body.matchAll(/(\d+) => \[(\d+), (\d+), (\d+)\]/g)].map((m) => [Number(m[1]), [Number(m[2]), Number(m[3]), Number(m[4])]]));
  expect(arms.size).toBe(19);
  for (const c of CLASSES) expect(arms.get(c.code)).toEqual(c.rgb);
});
