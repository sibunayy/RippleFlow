import { describe, expect, it, vi } from "vitest";
import type { VideoContent } from "../core/types";
import { MemoryAssets } from "../persist/assets";
import { ClipReader, type Sample, type SampleSource } from "./clipReader";
import { VideoLibrary } from "./videoLibrary";

const FPS = 30;
type FakeFrame = VideoFrame & { index: number; closed: boolean };
const frameObj = (i: number): FakeFrame => {
  const f = { index: i, timestamp: (i / FPS) * 1e6, duration: 1e6 / FPS, closed: false, close: () => void (f.closed = true) };
  return f as unknown as FakeFrame;
};

function fakeReader(n = 90, opts: { delayMs?: number } = {}) {
  const made: FakeFrame[] = [];
  const mk = (i: number): Sample => ({
    timestamp: i / FPS,
    duration: 1 / FPS,
    toVideoFrame: () => {
      const f = frameObj(i);
      made.push(f);
      return f;
    },
    close() {},
  });
  const source: SampleSource = {
    async getSample(t) {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return mk(Math.min(n - 1, Math.max(0, Math.floor(t * FPS + 1e-9))));
    },
    async *samples(start) {
      for (let i = Math.floor(start * FPS + 1e-9); i < n; i++) yield mk(i);
    },
  };
  return { reader: new ClipReader(source, { codedWidth: 16, codedHeight: 9, rotation: 0, duration: n / FPS, codec: "fake" }), made };
}

const asset = "0123456789abcdef0123456789abcdef";
const content = (over: Partial<VideoContent> = {}): VideoContent => ({ asset, codedWidth: 16, codedHeight: 9, rotation: 0, duration: 3, start: 0, ...over });

async function setup(opts: { delayMs?: number } = {}) {
  const assets = new MemoryAssets();
  await assets.put(asset, new Blob(["x"]));
  const { reader, made } = fakeReader(90, opts);
  const onChange = vi.fn();
  const lib = new VideoLibrary(assets, onChange, "external", async () => reader);
  return { lib, onChange, made, assets };
}
const idx = (r: { frame?: VideoFrame } | undefined) => (r?.frame as unknown as { index: number } | undefined)?.index;

describe("VideoLibrary.frameOf", () => {
  it("returns nothing at first, then the frame once decoded, and reports the change", async () => {
    const { lib, onChange } = await setup();
    expect(lib.frameOf(content(), 1)).toBeUndefined();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(idx(lib.frameOf(content(), 1))).toBe(30);
  });

  it("maps composition time through the clip's start and clamps outside it", async () => {
    const { lib, onChange } = await setup();
    const v = content({ start: 2 });
    lib.frameOf(v, 2.5); // clip time 0.5 -> frame 15
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(idx(lib.frameOf(v, 2.5))).toBe(15);
    lib.frameOf(v, 0); // before the clip starts: first frame
    await vi.waitFor(() => expect(idx(lib.frameOf(v, 0))).toBe(0));
  });

  it("keeps showing the current frame while the playhead stays inside it (no extra decode)", async () => {
    const { lib, onChange, made } = await setup();
    lib.frameOf(content(), 1);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const n = made.length;
    lib.frameOf(content(), 1 + 0.01);
    lib.frameOf(content(), 1 + 0.02);
    await new Promise((r) => setTimeout(r, 20));
    expect(made.length).toBe(n);
  });

  it("scrubbing decodes only the newest request, not every intermediate one", async () => {
    const { lib, onChange, made } = await setup({ delayMs: 30 });
    lib.frameOf(content(), 0.1);
    for (const t of [0.5, 0.9, 1.3, 1.7, 2.1]) lib.frameOf(content(), t);
    await vi.waitFor(() => expect(idx(lib.frameOf(content(), 2.1))).toBe(63), { timeout: 2000 });
    expect(made.length).toBeLessThanOrEqual(3); // first request, maybe one in flight, and the newest
    expect(onChange).toHaveBeenCalled();
  });

  it("closes old frames a few frames late, never the one on screen", async () => {
    const { lib, made } = await setup();
    const v = content();
    for (let i = 0; i < 12; i++) {
      lib.frameOf(v, i / FPS + 0.001);
      await vi.waitFor(() => expect(idx(lib.frameOf(v, i / FPS + 0.001))).toBe(i));
    }
    const shown = lib.frameOf(v, 11 / FPS + 0.001)!.frame as unknown as { closed: boolean };
    expect(shown.closed).toBe(false);
    expect(made.filter((f) => f.closed).length).toBeGreaterThanOrEqual(6); // old ones are released
    expect(made.slice(-4).every((f) => !f.closed)).toBe(true); // the recent few are still valid
  });

  it("a missing or undecodable clip is reported as failed", async () => {
    const onChange = vi.fn();
    const lib = new VideoLibrary(new MemoryAssets(), onChange, "external", async () => {
      throw new Error("nope");
    });
    expect(lib.frameOf(content(), 0)).toBeUndefined();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lib.failed()).toEqual([asset]);
  });
});

describe("VideoLibrary.import and export session", () => {
  it("stores the file once and returns content with the clip's geometry", async () => {
    const assets = new MemoryAssets();
    const { reader } = fakeReader();
    const lib = new VideoLibrary(assets, () => {}, "external", async () => reader);
    const a = await lib.import(new Blob(["clip-bytes"]), 1.5);
    const b = await lib.import(new Blob(["clip-bytes"]), 4);
    expect(a).toMatchObject({ codedWidth: 16, codedHeight: 9, rotation: 0, duration: 3, start: 1.5 });
    expect(b.asset).toBe(a.asset);
    expect(assets.blobs.size).toBe(1);
  });

  it("an export session streams frames in order and releases them", async () => {
    const { lib, made } = await setup();
    const session = lib.exportSession();
    for (let i = 0; i < 20; i++) expect(idx(await session.frame(content(), i / FPS + 0.001))).toBe(i);
    await session.close();
    expect(made.every((f) => f.closed)).toBe(true);
  });
});
