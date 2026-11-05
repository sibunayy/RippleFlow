import { describe, expect, it, vi } from "vitest";
import { ClipReader, type Sample, type SampleSource } from "./clipReader";

/** 30 fps fake clip of `n` frames. Counts decode work so tests can tell seeking from streaming. */
function fakeClip(n = 90, fps = 30) {
  const stats = { seeks: 0, decoded: 0, closed: 0, iterStarts: [] as number[] };
  const mk = (i: number): Sample => ({
    timestamp: i / fps,
    duration: 1 / fps,
    toVideoFrame: () => ({ index: i, close() {} }) as unknown as VideoFrame,
    close: () => void stats.closed++,
  });
  const source: SampleSource = {
    async getSample(t) {
      stats.seeks++;
      const i = Math.floor(t * fps + 1e-9);
      return i < 0 ? null : mk(Math.min(i, n - 1));
    },
    async *samples(start) {
      stats.iterStarts.push(start);
      for (let i = Math.floor(start * fps + 1e-9); i < n; i++) {
        stats.decoded++;
        yield mk(i);
      }
    },
  };
  const info = { codedWidth: 8, codedHeight: 8, rotation: 0 as const, duration: n / fps, codec: "fake" };
  return { reader: new ClipReader(source, info), stats };
}
const idx = async (r: ClipReader, t: number) => ((await r.frameAt(t)) as unknown as { index: number }).index;

describe("ClipReader", () => {
  it("returns the frame at or before t (frame accurate)", async () => {
    const { reader } = fakeClip();
    expect(await idx(reader, 0)).toBe(0);
    expect(await idx(reader, 1 / 30 + 0.001)).toBe(1);
    expect(await idx(reader, 59 / 30)).toBe(59);
  });

  it("plays forward by streaming: one seek, then no more", async () => {
    const { reader, stats } = fakeClip();
    for (let i = 0; i < 60; i++) expect(await idx(reader, i / 30 + 0.001)).toBe(i);
    expect(stats.seeks).toBe(1);
    expect(stats.iterStarts).toHaveLength(1);
  });

  it("repeating the same time reuses the frame without decoding", async () => {
    const { reader, stats } = fakeClip();
    await idx(reader, 0.5);
    const before = stats.decoded;
    await idx(reader, 0.5 + 0.001);
    expect(stats.decoded).toBe(before);
  });

  it("a backwards jump seeks again and is still accurate", async () => {
    const { reader, stats } = fakeClip();
    expect(await idx(reader, 2)).toBe(60);
    expect(await idx(reader, 0.5)).toBe(15);
    expect(stats.seeks).toBe(2);
    expect(await idx(reader, 0.5 + 1 / 30 + 0.001)).toBe(16); // and streaming resumes from there
    expect(stats.seeks).toBe(2);
  });

  it("a long forward jump seeks instead of decoding every frame in between", async () => {
    const { reader, stats } = fakeClip(900);
    await idx(reader, 0);
    expect(await idx(reader, 20)).toBe(600);
    expect(stats.seeks).toBe(2);
  });

  it("clamps before the start and holds the last frame after the end", async () => {
    const { reader } = fakeClip(90);
    expect(await idx(reader, -5)).toBe(0);
    expect(await idx(reader, 3)).toBe(89 - 0); // exactly the duration
    expect(await idx(reader, 100)).toBe(89);
  });

  it("concurrent requests are serialised, not interleaved", async () => {
    const { reader } = fakeClip();
    const got = await Promise.all([0.1, 0.5, 0.3, 1.0].map((t) => idx(reader, t)));
    expect(got).toEqual([3, 15, 9, 30]);
  });

  it("closes the samples it dropped and everything on close()", async () => {
    const { reader, stats } = fakeClip();
    for (let i = 0; i < 10; i++) await idx(reader, i / 30 + 0.001);
    await reader.close();
    expect(stats.closed).toBeGreaterThanOrEqual(10); // each consumed sample, plus the held ones
  });

  it("an empty clip gives null", async () => {
    const reader = new ClipReader({ getSample: async () => null, samples: async function* () {} }, { codedWidth: 1, codedHeight: 1, rotation: 0, duration: 0, codec: null });
    expect(await reader.frameAt(0)).toBeNull();
    vi.restoreAllMocks();
  });
});
