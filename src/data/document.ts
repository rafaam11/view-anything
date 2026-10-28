/** Byte-preserving document state, independent of the viewer and native I/O. */
export interface DocumentIO {
  read(): Promise<Uint8Array>;
  write(bytes: Uint8Array, expected: Uint8Array): Promise<boolean | void>;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export class FileDocument {
  private known: Uint8Array;
  private current: Uint8Array;
  private saving = false;
  private revision = 0;

  constructor(private readonly io: DocumentIO, bytes: Uint8Array) {
    this.known = bytes.slice();
    this.current = bytes.slice();
  }

  get dirty(): boolean { return !equalBytes(this.known, this.current); }
  get bytes(): Uint8Array { return this.current.slice(); }

  edit(bytes: Uint8Array): void { this.current = bytes.slice(); this.revision++; }

  /** Adopt freshly read disk contents after an explicit discard. */
  reset(bytes: Uint8Array): void {
    if (this.saving) throw new Error("저장이 이미 진행 중입니다");
    this.known = bytes.slice();
    this.current = bytes.slice();
    this.revision++;
  }

  /** Reload only when clean; never discard edits on focus. */
  async reload(): Promise<boolean> {
    if (this.dirty || this.saving) return false;
    const revision = this.revision;
    const disk = await this.io.read();
    if (revision !== this.revision || this.dirty || this.saving || equalBytes(this.known, disk)) return false;
    this.known = disk.slice();
    this.current = disk.slice();
    this.revision++;
    return true;
  }

  /** A conflict or unreadable source stops saving, retaining all edits. */
  async save(): Promise<"saved" | "unchanged" | "conflict"> {
    if (this.saving) throw new Error("저장이 이미 진행 중입니다");
    if (!this.dirty) return "unchanged";
    this.saving = true;
    const snapshot = this.current.slice();
    try {
      const disk = await this.io.read();
      if (!equalBytes(this.known, disk)) return "conflict";
      if (await this.io.write(snapshot, this.known.slice()) === false) return "conflict";
      this.known = snapshot;
      this.revision++;
      return "saved";
    } finally {
      this.saving = false;
    }
  }
}
