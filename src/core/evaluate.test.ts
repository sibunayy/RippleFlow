import { describe, expect, it } from "vitest";
import { cubicBezier } from "./easing";
import { evalTrack } from "./evaluate";
import type { Track } from "./types";

const track: Track = {
  keys: [
    { id: "a", t: 0, value: 0 },
    { id: "b", t: 2, value: 100 },
  ],
};

describe("evalTrack", () => {
  it("returns the fallback for an empty track", () => {
    expect(evalTrack({ keys: [] }, 1, 7)).toBe(7);
  });
  it("holds values outside the key range", () => {
    expect(evalTrack(track, -1)).toBe(0);
    expect(evalTrack(track, 5)).toBe(100);
  });
  it("interpolates linearly by default", () => {
    expect(evalTrack(track, 1)).toBeCloseTo(50);
  });
  it("applies bezier easing from the segment's start key", () => {
    const eased: Track = {
      keys: [
        { id: "a", t: 0, value: 0, ease: [0.42, 0, 1, 1] },
        { id: "b", t: 2, value: 100 },
      ],
    };
    expect(evalTrack(eased, 1)).toBeLessThan(50);
    expect(evalTrack(eased, 2)).toBe(100);
  });
});

describe("cubicBezier", () => {
  it("is the identity for linear handles", () => {
    expect(cubicBezier([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3, 4);
  });
  it("clamps at the ends", () => {
    expect(cubicBezier([0.25, 0.1, 0.25, 1], 0)).toBe(0);
    expect(cubicBezier([0.25, 0.1, 0.25, 1], 1)).toBe(1);
  });
});
