/** Binary project assets (imported pictures), stored by content hash so duplicates cost nothing. */
export interface AssetStore {
  has(id: string): Promise<boolean>;
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
}

export class MemoryAssets implements AssetStore {
  readonly blobs = new Map<string, Blob>();
  async has(id: string) {
    return this.blobs.has(id);
  }
  async put(id: string, blob: Blob) {
    this.blobs.set(id, blob);
  }
  async get(id: string) {
    return this.blobs.get(id) ?? null;
  }
}

const safe = (id: string) => {
  if (!/^[0-9a-f]{16,64}$/.test(id)) throw new Error(`Invalid asset id: ${id}`);
  return id;
};

/** Origin private file system, directory "assets". Writes are atomic (swap file, commit on close). */
export class OpfsAssets implements AssetStore {
  private async dir(create: boolean) {
    return (await navigator.storage.getDirectory()).getDirectoryHandle("assets", { create });
  }
  async has(id: string) {
    try {
      await (await this.dir(false)).getFileHandle(safe(id));
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return false;
      throw e;
    }
  }
  async put(id: string, blob: Blob) {
    const handle = await (await this.dir(true)).getFileHandle(safe(id), { create: true });
    const w = await handle.createWritable();
    try {
      await w.write(blob);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => {});
      throw e;
    }
  }
  async get(id: string) {
    try {
      return await (await (await this.dir(false)).getFileHandle(safe(id))).getFile();
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return null;
      throw e;
    }
  }
}

/** First 128 bits of SHA-256, as 32 lowercase hex characters. */
export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
