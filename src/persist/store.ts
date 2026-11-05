/** Where project text lives. OPFS in the app, memory in tests. */
export interface ProjectStore {
  load(id: string): Promise<string | null>;
  /** Replaces the whole file atomically: a crash mid-write leaves the previous version. */
  save(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryStore implements ProjectStore {
  readonly files = new Map<string, string>();
  async load(id: string) {
    return this.files.get(id) ?? null;
  }
  async save(id: string, text: string) {
    this.files.set(id, text);
  }
  async remove(id: string) {
    this.files.delete(id);
  }
}

const DIR = "projects";
const safe = (id: string) => {
  if (!/^[\w.-]+$/.test(id) || id.startsWith(".")) throw new Error(`Invalid project id: ${id}`);
  return `${id}.json`;
};

/** Origin private file system. createWritable() stages to a swap file and commits on close(). */
export class OpfsStore implements ProjectStore {
  private async dir(create: boolean) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(DIR, { create });
  }
  async load(id: string) {
    try {
      const file = await (await (await this.dir(false)).getFileHandle(safe(id))).getFile();
      return await file.text();
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return null;
      throw e;
    }
  }
  async save(id: string, text: string) {
    const handle = await (await this.dir(true)).getFileHandle(safe(id), { create: true });
    const w = await handle.createWritable();
    try {
      await w.write(text);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => {});
      throw e;
    }
  }
  async remove(id: string) {
    try {
      await (await this.dir(false)).removeEntry(safe(id));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
    }
  }
}

export const opfsAvailable = (): boolean => typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
