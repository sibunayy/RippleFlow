import { describe, expect, it } from "vitest";
import { tessellateFill } from "./fill";
import { meshArea } from "./mesh";
import { flatten } from "./path";
import { tessellateStroke } from "./stroke";
import { parseSvgPath } from "./svgPath";

const sub = (pts: number[], closed: boolean) => ({ points: pts, closed });
const square = (x: number, y: number, s: number) => [x, y, x + s, y, x + s, y + s, x, y + s];

describe("svg path parser", () => {
  it("handles relative commands, implicit repeats and close", () => {
    const cmds = parseSvgPath("m10 10 l5 0 0 5 z");
    expect(cmds.map((c) => c.t)).toEqual(["M", "L", "L", "Z"]);
    expect(cmds[2]).toMatchObject({ x: 15, y: 15 });
  });
  it("converts arcs: a full circle from two arcs has the right area", () => {
    const subs = flatten(parseSvgPath("M 0 50 A 50 50 0 1 1 100 50 A 50 50 0 1 1 0 50 Z"), 0.01);
    const area = meshArea(tessellateFill(subs));
    expect(area).toBeGreaterThan(Math.PI * 2500 * 0.999);
    expect(area).toBeLessThan(Math.PI * 2500 * 1.0001);
  });
  it("rejects garbage", () => {
    expect(() => parseSvgPath("L 1 2")).not.toThrow(); // lineto without moveto is tolerated
    expect(() => parseSvgPath("1 2")).toThrow();
  });
});

describe("flatten", () => {
  it("keeps endpoints and respects tolerance", () => {
    const [s] = flatten(parseSvgPath("M0 0 C 0 100 100 100 100 0"), 0.05);
    expect(s!.points.slice(0, 2)).toEqual([0, 0]);
    expect(s!.points.slice(-2)).toEqual([100, 0]);
    expect(s!.points.length / 2).toBeGreaterThan(10);
  });
});

describe("fill", () => {
  it("fills a square exactly", () => {
    expect(meshArea(tessellateFill([sub(square(0, 0, 10), true)]))).toBeCloseTo(100);
  });
  it("cuts a hole (even-odd nesting)", () => {
    const m = tessellateFill([sub(square(0, 0, 10), true), sub(square(3, 3, 4), true)]);
    expect(meshArea(m)).toBeCloseTo(100 - 16);
  });
  it("fills an island inside a hole", () => {
    const m = tessellateFill([
      sub(square(0, 0, 20), true),
      sub(square(2, 2, 16), true),
      sub(square(6, 6, 8), true),
    ]);
    expect(meshArea(m)).toBeCloseTo(400 - 256 + 64);
  });
  it("fills two disjoint shapes", () => {
    const m = tessellateFill([sub(square(0, 0, 4), true), sub(square(10, 0, 4), true)]);
    expect(meshArea(m)).toBeCloseTo(32);
  });
});

describe("stroke", () => {
  it("open line with butt caps has area length * width", () => {
    const m = tessellateStroke([sub([0, 0, 10, 0], false)], { width: 2 });
    expect(meshArea(m)).toBeCloseTo(20);
  });
  it("square caps extend by half the width at each end", () => {
    const m = tessellateStroke([sub([0, 0, 10, 0], false)], { width: 2, cap: "square" });
    expect(meshArea(m)).toBeCloseTo(24);
  });
  it("round caps add a full circle's area in total", () => {
    const m = tessellateStroke([sub([0, 0, 10, 0], false)], { width: 2, cap: "round", tolerance: 0.001 });
    expect(meshArea(m)).toBeGreaterThan(20 + Math.PI * 0.998);
    expect(meshArea(m)).toBeLessThan(20 + Math.PI * 1.0001);
  });
  it("closed square with miter joins covers outer minus inner", () => {
    const m = tessellateStroke([sub(square(0, 0, 10), true)], { width: 2, join: "miter" });
    // Outer 12x12 minus inner 8x8, but pieces overlap at the inner corners.
    expect(meshArea(m)).toBeGreaterThanOrEqual(144 - 64 - 1e-6);
  });
  it("bevel join on a right angle adds a triangle", () => {
    const m = tessellateStroke([sub([0, 0, 10, 0, 10, 10], false)], { width: 2, join: "bevel" });
    // Two 10x2 quads + a 1x1 bevel triangle (area 0.5).
    expect(meshArea(m)).toBeCloseTo(40.5);
  });
  it("miter limit falls back to bevel on sharp angles", () => {
    const pts = [0, 0, 10, 0, 0, 1];
    const miter = meshArea(tessellateStroke([sub(pts, false)], { width: 1, join: "miter", miterLimit: 100 }));
    const limited = meshArea(tessellateStroke([sub(pts, false)], { width: 1, join: "miter", miterLimit: 2 }));
    expect(limited).toBeLessThan(miter);
  });
  it("handles a 180 degree reversal without NaNs", () => {
    const m = tessellateStroke([sub([0, 0, 10, 0, 0, 0.0001], false)], { width: 2, join: "round" });
    expect(Array.from(m.positions).every(Number.isFinite)).toBe(true);
  });
});
