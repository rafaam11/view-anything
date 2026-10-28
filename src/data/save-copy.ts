import { platform } from "../platform";

/** Save a recovery copy; a pre-existing target is never overwritten. */
export async function saveCopy(path: string, bytes: Uint8Array): Promise<boolean> {
  const match = /^(.*?)(\.[^\\/.]+)?$/.exec(path);
  const suggested = match ? `${match[1]}-copy${match[2] ?? ""}` : `${path}-copy`;
  const target = await platform.saveDialog({ title: "다른 이름으로 저장", defaultPath: suggested });
  if (!target) return false;
  await platform.writeFileNew(target, bytes);
  return true;
}
