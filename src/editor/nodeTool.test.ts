import { describe, expect, it } from "vitest";
import { IDENTITY, scale, translate, multiply } from "../core/affine";
import { parseNodes } from "../geometry/nodes";
import { NodeTool, type NodeContext } from "./nodeTool";

const rect = parseNodes("M0 0 H100 V100 H0 Z");
const ctx = (m = IDENTITY, unitsPerPx = 1): NodeContext => ({ paths: rect, matrix: m, unitsPerPx });

describe("NodeTool", () => {
  it("tapping a point selects it", () => {
    const t = new NodeTool();
    expect(t.down(1, 101, 2, ctx()).select).toEqual({ pi: 0, ni: 1 });
    expect(t.up(1, 101, 2, ctx())).toEqual({});
    expect(t.selection).toEqual({ pi: 0, ni: 1 });
  });
  it("dragging moves the point; every output is the total from the start", () => {
    const t = new NodeTool();
    t.down(1, 100, 0, ctx());
    const mid = t.move(1, 110, 5, ctx()).edit!;
    expect(mid.final).toBe(false);
    expect(mid.paths[0]!.nodes[1]).toMatchObject({ x: 110, y: 5 });
    const end = t.up(1, 130, 20, ctx()).edit!;
    expect(end.final).toBe(true);
    expect(end.paths[0]!.nodes[1]).toMatchObject({ x: 130, y: 20 });
  });
  it("works through a layer transform (scaled and offset)", () => {
    const m = multiply(translate(500, 300), scale(2));
    const t = new NodeTool();
    t.down(1, 500 + 200, 300, ctx(m)); // node (100,0) is at comp (700,300)
    const end = t.up(1, 700 + 40, 300 + 20, ctx(m)).edit!; // 40,20 comp px = 20,10 local
    expect(end.paths[0]!.nodes[1]).toMatchObject({ x: 120, y: 10 });
  });
  it("a tiny wobble while tapping does not edit", () => {
    const t = new NodeTool();
    t.down(1, 100, 0, ctx());
    expect(t.move(1, 101, 1, ctx())).toEqual({});
    expect(t.up(1, 101, 1, ctx()).edit).toBeUndefined();
  });
  it("tapping the outline adds a point and selects it", () => {
    const t = new NodeTool();
    t.down(1, 50, 4, ctx());
    const out = t.up(1, 50, 4, ctx());
    expect(out.edit!.paths[0]!.nodes).toHaveLength(5);
    expect(out.select).toEqual({ pi: 0, ni: 1 });
    expect(out.edit!.paths[0]!.nodes[1]).toMatchObject({ x: 50, y: 0 });
  });
  it("tapping empty space deselects", () => {
    const t = new NodeTool();
    t.setSelection({ pi: 0, ni: 2 });
    t.down(1, 300, 300, ctx());
    expect(t.up(1, 300, 300, ctx()).select).toBeNull();
  });
  it("drags the selected point's handle before picking nodes under it", () => {
    const p = parseNodes("M0 0 C0 0 50 0 100 0");
    const c = { paths: [{ ...p[0]!, nodes: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 30, oy: 0 }, { x: 100, y: 0, ix: -20, iy: 0, ox: 0, oy: 0 }] }], matrix: IDENTITY, unitsPerPx: 1 };
    const t = new NodeTool();
    t.setSelection({ pi: 0, ni: 0 });
    t.down(1, 30, 0, c);
    const end = t.up(1, 40, 25, c).edit!;
    expect(end.paths[0]!.nodes[0]).toMatchObject({ x: 0, ox: 40, oy: 25 });
  });
  it("hit radius scales with zoom", () => {
    const t = new NodeTool();
    // 100 px from the node but the view is zoomed out 10x, so that is 10 screen px.
    expect(t.down(1, 100, 15, ctx(IDENTITY, 10)).select).toEqual({ pi: 0, ni: 1 });
  });
  it("ignores a second pointer while one is active, and cancel resets", () => {
    const t = new NodeTool();
    t.down(1, 100, 0, ctx());
    expect(t.down(2, 0, 0, ctx())).toEqual({});
    t.cancel();
    expect(t.dragging).toBe(false);
  });
});
