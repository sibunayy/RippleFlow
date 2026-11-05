import { describe, expect, it } from "vitest";
import type { Composition } from "../core/types";
import { exportSize, PRESETS } from "./exportComposition";

const comp = (w: number, h: number): Composition => ({ width: w, height: h, fps: 30, duration: 1, layers: [] });

describe("exportSize", () => {
  it("keeps 16:9 exact", () => {
    expect(exportSize(comp(1920, 1080), PRESETS[0]!)).toEqual({ width: 1280, height: 720 });
    expect(exportSize(comp(1920, 1080), PRESETS[2]!)).toEqual({ width: 1920, height: 1080 });
  });
  it("always gives even dimensions", () => {
    for (const p of PRESETS) for (const [w, h] of [[1000, 700], [1080, 1920], [1111, 999]] as const) {
      const s = exportSize(comp(w, h), p);
      expect(s.width % 2).toBe(0);
      expect(s.height % 2).toBe(0);
    }
  });
  it("handles vertical video", () => {
    expect(exportSize(comp(1080, 1920), PRESETS[1]!)).toEqual({ width: 608, height: 1080 });
  });
});
