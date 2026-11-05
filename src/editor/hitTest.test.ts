import { describe, expect, it } from "vitest";
import { rotate, scale, translate, multiply, IDENTITY } from "../core/affine";
import type { SceneItem } from "../core/scene";
import { hitTest, type Bounds } from "./hitTest";

const box: Bounds = { x: 0, y: 0, w: 100, h: 100 };
const item = (id: string, matrix = IDENTITY): SceneItem => ({ id, kind: "shape", matrix, opacity: 1, blend: "normal", effects: [], masks: [] });
const all = () => box;

describe("hitTest", () => {
  it("returns the topmost overlapping layer", () => {
    expect(hitTest([item("a"), item("b")], all, 50, 50)).toBe("b");
  });
  it("misses outside bounds", () => {
    expect(hitTest([item("a")], all, 150, 50)).toBeNull();
  });
  it("respects the layer transform", () => {
    const m = multiply(translate(200, 0), scale(2));
    expect(hitTest([item("a", m)], all, 300, 100)).toBe("a");
    expect(hitTest([item("a", m)], all, 150, 100)).toBeNull();
  });
  it("handles rotation", () => {
    const m = multiply(translate(100, 0), rotate(Math.PI / 2)); // box spans x 0..100, y 0..100 -> x 0..100
    expect(hitTest([item("a", m)], all, 50, 50)).toBe("a");
    expect(hitTest([item("a", m)], all, 120, 50)).toBeNull();
  });
  it("slop widens the target in composition units", () => {
    expect(hitTest([item("a")], all, 110, 50)).toBeNull();
    expect(hitTest([item("a")], all, 110, 50, 12)).toBe("a");
    const m = scale(2); // box now 0..200; slop 12 comp units = 6 local
    expect(hitTest([item("a", m)], all, 210, 50, 12)).toBe("a");
    expect(hitTest([item("a", m)], all, 220, 50, 12)).toBeNull();
  });
  it("skips layers with no bounds and singular matrices", () => {
    expect(hitTest([item("a")], () => undefined, 50, 50)).toBeNull();
    expect(hitTest([item("a", scale(0))], all, 0, 0)).toBeNull();
  });
});
