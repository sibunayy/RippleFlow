import { describe, expect, it } from "vitest";
import type { Composition, Layer, Track } from "../core/types";
import { hexToRgba, rgbToHex } from "./color";
import { addStopAfter, fillModeOf, patchStroke, removeStop, setFillColor, setFillMode, setGradientAngle, setStopOffset, setStrokeEnabled } from "./styleEdit";
import { setBlend } from "../core/commands";

const e: Track = { keys: [] };
const layer: Layer = { id: "a", name: "a", kind: "shape", transform: { anchorX: e, anchorY: e, x: e, y: e, scaleX: e, scaleY: e, rotation: e, opacity: e }, shape: { path: "M0 0 H1 V1 Z", fill: [1, 0, 0, 1] } };
const comp: Composition = { width: 10, height: 10, fps: 30, duration: 1, layers: [layer] };
const shapeOf = (c: Composition) => c.layers[0]!.shape!;

describe("colour helpers", () => {
  it("round-trips hex", () => expect(rgbToHex(hexToRgba("#ff8000")!)).toBe("#ff8000"));
  it("expands #rgb and rejects junk", () => {
    expect(hexToRgba("#f00")).toEqual([1, 0, 0, 1]);
    expect(hexToRgba("red")).toBeNull();
  });
});

describe("fill modes", () => {
  it("none removes fill and gradient, solid restores the colour", () => {
    const lin = setFillMode("a", "linear").apply(comp);
    expect(fillModeOf(shapeOf(lin))).toBe("linear");
    expect(shapeOf(lin).gradient!.stops[0]!.color).toEqual([1, 0, 0, 1]);
    const none = setFillMode("a", "none").apply(lin);
    expect(shapeOf(none).fill).toBeUndefined();
    expect(shapeOf(none).gradient).toBeUndefined();
    expect(shapeOf(setFillMode("a", "solid").apply(lin)).gradient).toBeUndefined();
  });
  it("linear to radial keeps the stops; same mode is a no-op", () => {
    const lin = setFillMode("a", "linear").apply(comp);
    const rad = setFillMode("a", "radial").apply(lin);
    expect(shapeOf(rad).gradient!.stops).toEqual(shapeOf(lin).gradient!.stops);
    expect(setFillMode("a", "radial").apply(rad)).toBe(rad);
  });
  it("sets the solid colour", () => expect(shapeOf(setFillColor("a", [0, 1, 0, 1]).apply(comp)).fill).toEqual([0, 1, 0, 1]));
});

describe("gradient stops", () => {
  const lin = setFillMode("a", "linear").apply(comp);
  it("adds a midpoint stop between neighbours and sorts", () => {
    const g = shapeOf(addStopAfter("a", 0).apply(lin)).gradient!;
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
  });
  it("refuses fewer than two stops", () => expect(() => removeStop("a", 0).apply(lin)).toThrow(/two/));
  it("removes when more than two", () => expect(shapeOf(removeStop("a", 1).apply(addStopAfter("a", 0).apply(lin))).gradient!.stops).toHaveLength(2));
  it("clamps offsets into 0..1 and keeps ascending order", () => {
    const g = shapeOf(setStopOffset("a", 0, 5).apply(lin)).gradient!;
    expect(g.stops.map((s) => s.offset)).toEqual([1, 1]);
  });
  it("sets the angle", () => expect(shapeOf(setGradientAngle("a", 45).apply(lin)).gradient!.angle).toBe(45));
  it("cannot edit a gradient that is not there", () => expect(() => setGradientAngle("a", 1).apply(comp)).toThrow());
});

describe("stroke and blend", () => {
  it("adds, edits and removes a stroke", () => {
    const on = setStrokeEnabled("a", true).apply(comp);
    expect(shapeOf(on).stroke!.width).toBe(8);
    const wide = patchStroke("a", "Stroke width", { width: 20 }).apply(on);
    expect(shapeOf(wide).stroke!.width).toBe(20);
    expect(() => patchStroke("a", "w", { width: 0 }).apply(on)).toThrow();
    expect(shapeOf(setStrokeEnabled("a", false).apply(wide)).stroke).toBeUndefined();
  });
  it("blend modes set and clear", () => {
    const m = setBlend("a", "multiply").apply(comp);
    expect(m.layers[0]!.blend).toBe("multiply");
    expect(setBlend("a", "normal").apply(m).layers[0]!.blend).toBeUndefined();
    expect(setBlend("a", "normal").apply(comp)).toBe(comp);
  });
});
