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

const SAMPLE_BYTES = 1 << 20;

/**
 * Cheap fingerprint for large files (videos): SHA-256 over the size plus three
 * 1 MB slices (start, middle, end). Two different files agreeing on all of
 * those is not a realistic accident, and it avoids reading a 500 MB clip into memory.
 */
export async function hashBlobSampled(blob: Blob): Promise<string> {
  if (blob.size <= 3 * SAMPLE_BYTES) return hashBlob(blob);
  const mid = Math.floor(blob.size / 2) - SAMPLE_BYTES / 2;
  const parts = [
    new TextEncoder().encode(String(blob.size)),
    new Uint8Array(await blob.slice(0, SAMPLE_BYTES).arrayBuffer()),
    new Uint8Array(await blob.slice(mid, mid + SAMPLE_BYTES).arrayBuffer()),
    new Uint8Array(await blob.slice(blob.size - SAMPLE_BYTES).arrayBuffer()),
  ];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", all);
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** First 128 bits of SHA-256, as 32 lowercase hex characters. */
export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
