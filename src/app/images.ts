import type { ImageContent } from "../core/types";
import { hashBlob, type AssetStore } from "../persist/assets";

/** Largest side kept in memory. 12 MP photos are shrunk on import; the original file is stored untouched. */
export const MAX_IMAGE_SIDE = 2048;

/** Size after fitting inside `max` on the long side, never enlarging. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Decode with EXIF orientation applied, then shrink if oversized. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  const full = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const fit = fitWithin(full.width, full.height);
  if (fit.width === full.width && fit.height === full.height) return full;
  const small = await createImageBitmap(full, { resizeWidth: fit.width, resizeHeight: fit.height, resizeQuality: "high" });
  full.close();
  return small;
}

type Entry = { state: "loading" } | { state: "ready"; bitmap: ImageBitmap } | { state: "failed"; error: unknown };

/**
 * Loaded pictures by asset id. `bitmapOf` is synchronous (the render path) and
 * starts a background load on first use, calling `onChange` when it finishes.
 */
export class ImageLibrary {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly assets: AssetStore,
    private readonly onChange: () => void,
    private readonly decode: (blob: Blob) => Promise<ImageBitmap> = decodeImage,
  ) {}

  bitmapOf(asset: string): ImageBitmap | undefined {
    const e = this.entries.get(asset);
    if (!e) {
      this.entries.set(asset, { state: "loading" });
      void this.load(asset);
      return undefined;
    }
    return e.state === "ready" ? e.bitmap : undefined;
  }

  /** Asset ids that could not be read or decoded (for a "missing picture" notice). */
  failed(): string[] {
    return [...this.entries].filter(([, e]) => e.state === "failed").map(([id]) => id);
  }

  /** Import a picture: store the original bytes by content hash, decode, and return its layer content. */
  async import(file: Blob): Promise<ImageContent> {
    const bitmap = await this.decode(file); // fail before storing anything if it is not a picture
    const asset = await hashBlob(file);
    try {
      if (!(await this.assets.has(asset))) await this.assets.put(asset, file);
    } catch (e) {
      bitmap.close();
      throw e;
    }
    const old = this.entries.get(asset);
    if (old?.state === "ready") bitmap.close();
    else this.entries.set(asset, { state: "ready", bitmap });
    return { asset, width: bitmap.width, height: bitmap.height };
  }

  private async load(asset: string): Promise<void> {
    try {
      const blob = await this.assets.get(asset);
      if (!blob) throw new Error(`Picture ${asset} is missing from storage`);
      this.entries.set(asset, { state: "ready", bitmap: await this.decode(blob) });
    } catch (error) {
      this.entries.set(asset, { state: "failed", error });
    }
    this.onChange();
  }
}
