import { describe, expect, it } from "vitest";
import { buildShapeGeometry } from "./layerGeometry";

describe("buildShapeGeometry", () => {
  it("builds a fill and measures bounds", () => {
    const g = buildShapeGeometry({ path: "M10 20 H110 V70 H10 Z", fill: [1, 0, 0, 1] });
    expect(g.parts).toHaveLength(1);
    expect(g.bounds).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });
  it("stroke widens bounds and draws after the fill", () => {
    const g = buildShapeGeometry({
      path: "M0 0 H100 V100 H0 Z",
      fill: [1, 0, 0, 1],
      stroke: { color: [0, 0, 0, 1], width: 10, join: "miter" },
    });
    expect(g.parts).toHaveLength(2);
    expect(g.parts[1]!.color).toEqual([0, 0, 0, 1]);
    expect(g.bounds!.x).toBeCloseTo(-5, 3);
    expect(g.bounds!.w).toBeCloseTo(110, 3);
  });
  it("has no bounds when there is nothing to draw", () => {
    expect(buildShapeGeometry({ path: "M0 0" }).bounds).toBeUndefined();
    expect(buildShapeGeometry({ path: "M0 0 L10 0 L10 10 Z" }).bounds).toBeUndefined();
  });
});

import { apply } from "../core/affine";
import { buildVideoGeometry, displaySize, rotationMatrix } from "./layerGeometry";

describe("video geometry", () => {
  const near = (a: readonly number[], e: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(e[i]!, 6));
  it("rotation lands the coded corners on the display rectangle", () => {
    // coded 1920x1080 landscape pixels, flagged to rotate 90 clockwise: shown 1080 wide, 1920 tall.
    const m = rotationMatrix(90, 1920, 1080);
    near(apply(m, 0, 0), [1080, 0]); // coded top-left goes to display top-right
    near(apply(m, 1920, 0), [1080, 1920]);
    near(apply(m, 0, 1080), [0, 0]);
    const m270 = rotationMatrix(270, 1920, 1080);
    near(apply(m270, 0, 0), [0, 1920]); // top-left goes to bottom-left
    near(apply(m270, 1920, 1080), [1080, 0]);
    const m180 = rotationMatrix(180, 1920, 1080);
    near(apply(m180, 0, 0), [1920, 1080]);
    expect(rotationMatrix(0, 1920, 1080)).toEqual([1, 0, 0, 1, 0, 0]);
  });
  it("reports display size and bounds after rotation", () => {
    const v = { asset: "a", codedWidth: 1920, codedHeight: 1080, rotation: 90 as const, duration: 4, start: 0 };
    expect(displaySize(v)).toEqual({ width: 1080, height: 1920 });
    expect(buildVideoGeometry(v).bounds).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(displaySize({ ...v, rotation: 0 })).toEqual({ width: 1920, height: 1080 });
  });
});
