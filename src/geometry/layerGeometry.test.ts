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
