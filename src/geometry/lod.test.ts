import { describe, expect, it } from "vitest";
import { localTolerance, needsRetessellation } from "./lod";

describe("tessellation LOD", () => {
  it("tightens the local tolerance as scale grows", () => {
    expect(localTolerance(4)).toBeCloseTo(localTolerance(1) / 4);
  });
  it("does not rebuild for small zooms or when scaling down", () => {
    expect(needsRetessellation(2, 2.5)).toBe(false);
    expect(needsRetessellation(2, 0.5)).toBe(false);
  });
  it("rebuilds when zoomed well past the built scale", () => {
    expect(needsRetessellation(2, 4)).toBe(true);
  });
});
