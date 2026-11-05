import { describe, expect, it } from "vitest";
import { nodesToPath, pathBounds, transformPath } from "../geometry/nodes";
import { scale, translate, multiply } from "../core/affine";
import { PenTool } from "./penTool";

describe("PenTool", () => {
  const tap = (t: PenTool, id: number, x: number, y: number) => {
    const o = t.down(id, x, y, 1);
    t.up(id);
    return o;
  };
  it("taps make corner points", () => {
    const t = new PenTool();
    tap(t, 1, 0, 0);
    tap(t, 2, 100, 0);
    tap(t, 3, 100, 100);
    expect(t.count).toBe(3);
    expect(nodesToPath([{ ...t.path, closed: true }])).toBe("M0 0L100 0L100 100Z");
  });
  it("dragging pulls a smooth curve (mirrored handles)", () => {
    const t = new PenTool();
    t.down(1, 50, 50, 1);
    t.move(1, 80, 50, 1);
    t.up(1);
    expect(t.path.nodes[0]).toMatchObject({ x: 50, y: 50, ox: 30, oy: 0, ix: -30, iy: -0 });
  });
  it("a wobble under the threshold stays a corner", () => {
    const t = new PenTool();
    t.down(1, 50, 50, 1);
    t.move(1, 52, 51, 1);
    t.up(1);
    expect(t.path.nodes[0]).toMatchObject({ ox: 0, oy: 0 });
  });
  it("tapping near the first point closes, but only with three points", () => {
    const t = new PenTool();
    tap(t, 1, 0, 0);
    expect(tap(t, 2, 5, 5).closed).toBeUndefined(); // only one point yet: this is a second point
    tap(t, 3, 100, 0);
    expect(tap(t, 4, 3, 3).closed).toBe(true);
    expect(t.count).toBe(3);
  });
  it("close radius is in screen pixels (scales with zoom)", () => {
    const t = new PenTool();
    tap(t, 1, 0, 0);
    tap(t, 2, 100, 0);
    tap(t, 3, 100, 100);
    expect(t.down(4, 150, 0, 10).closed).toBe(true); // 150 units away but zoomed out 10x = 15 px
  });
  it("pops the last point", () => {
    const t = new PenTool();
    tap(t, 1, 0, 0);
    tap(t, 2, 10, 0);
    t.popPoint();
    expect(t.count).toBe(1);
  });
});

describe("path transforms", () => {
  it("maps points and handle offsets", () => {
    const p = { closed: false, nodes: [{ x: 1, y: 1, ix: -1, iy: 0, ox: 1, oy: 0 }] };
    const out = transformPath(p, multiply(translate(10, 10), scale(2)));
    expect(out.nodes[0]).toEqual({ x: 12, y: 12, ix: -2, iy: 0, ox: 2, oy: 0 });
  });
  it("bounds include handle tips", () => {
    expect(pathBounds([{ closed: false, nodes: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 50, oy: 20 }, { x: 10, y: 10, ix: 0, iy: 0, ox: 0, oy: 0 }] }])).toEqual({ x: 0, y: 0, w: 50, h: 20 });
  });
});
