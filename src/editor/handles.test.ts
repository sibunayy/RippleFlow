import { describe, expect, it } from "vitest";
import { apply, multiply, rotate, translate, IDENTITY } from "../core/affine";
import { cornerScaleDelta, hitCorner, moveDelta, rotateDelta, worldCorners } from "./handles";

const b = { x: 0, y: 0, w: 100, h: 50 };
const near = (a: readonly number[], e: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(e[i]!, 6));

describe("handles", () => {
  it("scales about the opposite corner", () => {
    const d = cornerScaleDelta(2, b, IDENTITY, [200, 100], false)!;
    near(apply(d, 0, 0), [0, 0]); // pivot fixed
    near(apply(d, 100, 50), [200, 100]); // dragged corner follows pointer
  });
  it("uniform scale keeps aspect", () => {
    const d = cornerScaleDelta(2, b, IDENTITY, [200, 60], true)!;
    near(apply(d, 100, 50), [200, 100]);
  });
  it("works on a rotated layer", () => {
    const m = multiply(translate(10, 10), rotate(Math.PI / 6));
    const target = apply(m, 200, 100); // pointer where a 2x corner would be
    const d = cornerScaleDelta(2, b, m, target, false)!;
    const [c0, , c2] = worldCorners(b, m);
    near(apply(d, c0![0], c0![1]), c0!);
    near(apply(d, c2![0], c2![1]), target);
  });
  it("rejects degenerate drags", () => {
    expect(cornerScaleDelta(2, b, IDENTITY, [0, 0], false)).toBeNull();
    expect(cornerScaleDelta(2, b, [0, 0, 0, 0, 0, 0], [5, 5], false)).toBeNull();
  });
  it("rotates about a pivot, with snapping", () => {
    near(apply(rotateDelta([0, 0], [10, 0], [0, 10]), 10, 0), [0, 10]); // +90 deg clockwise (y-down)
    const snapped = rotateDelta([0, 0], [10, 0], [10, 1], 15); // ~5.7 deg -> 0
    near(apply(snapped, 10, 0), [10, 0]);
  });
  it("moves", () => near(apply(moveDelta([1, 2], [4, 6]), 0, 0), [3, 4]));
  it("hits the nearest corner within radius", () => {
    expect(hitCorner(b, IDENTITY, 98, 52, 10)).toBe(2);
    expect(hitCorner(b, IDENTITY, 50, 25, 10)).toBeNull();
  });
});
