import { describe, expect, it, vi } from "vitest";
import { MemoryAssets } from "../persist/assets";
import { fitWithin, ImageLibrary } from "./images";

const bmp = (w: number, h: number) => ({ width: w, height: h, close: vi.fn() }) as unknown as ImageBitmap;
const blob = (text: string) => new Blob([text], { type: "image/png" });

describe("fitWithin", () => {
  it("shrinks the long side and keeps the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
  });
  it("never enlarges and never reaches zero", () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 1, 2048).height).toBe(1);
  });
});

describe("ImageLibrary", () => {
  it("imports once per content: same bytes give the same asset and one stored copy", async () => {
    const assets = new MemoryAssets();
    const lib = new ImageLibrary(assets, () => {}, async () => bmp(640, 480));
    const a = await lib.import(blob("same"));
    const b = await lib.import(blob("same"));
    const c = await lib.import(blob("different"));
    expect(a).toEqual({ asset: expect.stringMatching(/^[0-9a-f]{32}$/), width: 640, height: 480 });
    expect(b.asset).toBe(a.asset);
    expect(c.asset).not.toBe(a.asset);
    expect(assets.blobs.size).toBe(2);
    expect(lib.bitmapOf(a.asset)).toBeDefined(); // already decoded: no reload needed
  });

  it("a file that does not decode stores nothing", async () => {
    const assets = new MemoryAssets();
    const lib = new ImageLibrary(assets, () => {}, async () => {
      throw new Error("not an image");
    });
    await expect(lib.import(blob("junk"))).rejects.toThrow("not an image");
    expect(assets.blobs.size).toBe(0);
  });

  it("loads from storage in the background and reports when ready", async () => {
    const assets = new MemoryAssets();
    const a = await new ImageLibrary(assets, () => {}, async () => bmp(10, 10)).import(blob("x"));
    const onChange = vi.fn();
    const fresh = new ImageLibrary(assets, onChange, async () => bmp(10, 10)); // like a reload
    expect(fresh.bitmapOf(a.asset)).toBeUndefined(); // first use starts the load
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(fresh.bitmapOf(a.asset)).toBeDefined();
    expect(fresh.failed()).toEqual([]);
  });

  it("records a missing asset as failed instead of retrying forever", async () => {
    const onChange = vi.fn();
    const lib = new ImageLibrary(new MemoryAssets(), onChange, async () => bmp(1, 1));
    expect(lib.bitmapOf("0123456789abcdef0123456789abcdef")).toBeUndefined();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lib.failed()).toEqual(["0123456789abcdef0123456789abcdef"]);
    lib.bitmapOf("0123456789abcdef0123456789abcdef");
    await new Promise((r) => setTimeout(r, 10));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
