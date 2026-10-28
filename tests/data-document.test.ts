import { expect, test } from "vitest";
import { FileDocument } from "../src/data/document";

const bytes = (s: string) => new TextEncoder().encode(s);

test("a conflict keeps both disk and edits intact", async () => {
  let disk = bytes("original");
  const doc = new FileDocument({ read: async () => disk, write: async b => { disk = b; } }, disk);
  doc.edit(bytes("edit"));
  disk = bytes("external");
  expect(await doc.save()).toBe("conflict");
  expect(disk).toEqual(bytes("external"));
  expect(doc.bytes).toEqual(bytes("edit"));
  expect(doc.dirty).toBe(true);
});

test("edits made during a write remain dirty after it finishes", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let written = bytes("");
  const doc = new FileDocument({ read: async () => bytes("old"), write: async b => { written = b; await pending; } }, bytes("old"));
  doc.edit(bytes("first"));
  const saving = doc.save();
  await Promise.resolve();
  doc.edit(bytes("second"));
  finish();
  expect(await saving).toBe("saved");
  expect(written).toEqual(bytes("first"));
  expect(doc.bytes).toEqual(bytes("second"));
  expect(doc.dirty).toBe(true);
});

test("reload does not replace edits made while reading", async () => {
  let finish!: (b: Uint8Array) => void;
  const doc = new FileDocument({ read: () => new Promise(resolve => { finish = resolve; }), write: async () => {} }, bytes("old"));
  const loading = doc.reload();
  doc.edit(bytes("edit"));
  finish(bytes("external"));
  expect(await loading).toBe(false);
  expect(doc.bytes).toEqual(bytes("edit"));
});

test("read and write errors retain the dirty state", async () => {
  const doc = new FileDocument({ read: async () => { throw new Error("offline"); }, write: async () => {} }, bytes("old"));
  doc.edit(bytes("new"));
  await expect(doc.save()).rejects.toThrow("offline");
  expect(doc.dirty).toBe(true);
});

test("save snapshots edits before waiting for the disk read", async () => {
  let finish!: (bytes: Uint8Array) => void;
  let written = bytes("");
  const doc = new FileDocument({ read: () => new Promise(resolve => { finish = resolve; }), write: async b => { written = b; } }, bytes("old"));
  doc.edit(bytes("first"));
  const saving = doc.save();
  doc.edit(bytes("second"));
  finish(bytes("old"));
  expect(await saving).toBe("saved");
  expect(written).toEqual(bytes("first"));
  expect(doc.dirty).toBe(true);
});

test("a stale focus reload cannot revert a completed save", async () => {
  let resolveReload!: (b: Uint8Array) => void;
  let reads = 0;
  const doc = new FileDocument({
    read: () => ++reads === 1 ? new Promise(resolve => { resolveReload = resolve; }) : Promise.resolve(bytes("old")),
    write: async () => {},
  }, bytes("old"));
  const reload = doc.reload();
  doc.edit(bytes("new"));
  expect(await doc.save()).toBe("saved");
  resolveReload(bytes("old"));
  expect(await reload).toBe(false);
  expect(doc.bytes).toEqual(bytes("new"));
  expect(doc.dirty).toBe(false);
});
