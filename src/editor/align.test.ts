import { describe, expect, it } from "vitest";
import { rotate, translate, multiply } from "../core/affine";
import { alignDelta, unionBox, worldBox } from "./align";

describe("align", () => {
  const box = { x: 100, y: 50, w: 200, h: 100 };
  it("moves a box to each edge and centre of a 1000x600 composition", () => {
    expect(alignDelta(box, "left", 1000, 600)).toEqual([-100, 0]);
    expect(alignDelta(box, "right", 1000, 600)).toEqual([700, 0]);
    expect(alignDelta(box, "centerX", 1000, 600)).toEqual([300, 0]);
    expect(alignDelta(box, "top", 1000, 600)).toEqual([0, -50]);
    expect(alignDelta(box, "bottom", 1000, 600)).toEqual([0, 450]);
    expect(alignDelta(box, "centerY", 1000, 600)).toEqual([0, 200]);
  });
  it("uses the rotated layer's axis-aligned box", () => {
    const b = worldBox({ x: 0, y: 0, w: 100, h: 100 }, multiply(translate(200, 0), rotate(Math.PI / 4)));
    expect(b.w).toBeCloseTo(141.42, 1);
    expect(b.x).toBeCloseTo(200 - 70.71, 1);
  });
  it("unions boxes", () => {
    expect(unionBox([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
    expect(unionBox([])).toBeNull();
  });
});
