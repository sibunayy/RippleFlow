import { describe, expect, it } from "vitest";
import { evalTrack } from "../core/evaluate";
import type { Composition, Layer, Track } from "../core/types";
import { clampEase, PRESETS, setEase } from "./easingEdit";
import { keyColumns } from "./keyframeEdit";

const empty: Track = { keys: [] };
const tr = (...v: [number, number][]): Track => ({ keys: v.map(([t, value], i) => ({ id: `k${i}`, t, value })) });
const layer: Layer = {
  id: "a",
  name: "A",
  kind: "shape",
  transform: { anchorX: empty, anchorY: empty, x: tr([0, 0], [2, 100]), y: tr([0, 0], [2, 10]), scaleX: empty, scaleY: empty, rotation: empty, opacity: empty },
};
const comp = (): Composition => ({ width: 1, height: 1, fps: 30, duration: 5, layers: [layer] });

describe("setEase", () => {
  it("applies to every property in a column and changes the curve", () => {
    const col = keyColumns(layer)[0]!;
    const c = setEase(col.refs, [0.42, 0, 1, 1]).apply(comp());
    expect(c.layers[0]!.transform.x.keys[0]!.ease).toEqual([0.42, 0, 1, 1]);
    expect(c.layers[0]!.transform.y.keys[0]!.ease).toEqual([0.42, 0, 1, 1]);
    expect(evalTrack(c.layers[0]!.transform.x, 1)).toBeLessThan(50); // ease-in is behind linear at the midpoint
    expect(c.layers[0]!.transform.x.keys[1]!.ease).toBeUndefined(); // other key untouched
  });
  it("clears with undefined, and is a no-op when unchanged", () => {
    const col = keyColumns(layer)[0]!;
    const eased = setEase(col.refs, [0, 0, 0.58, 1]).apply(comp());
    const cleared = setEase(col.refs, undefined).apply(eased);
    expect("ease" in cleared.layers[0]!.transform.x.keys[0]!).toBe(false);
    const base = comp();
    expect(setEase(col.refs, undefined).apply(base)).toBe(base);
    expect(setEase(col.refs, [0, 0, 0.58, 1]).apply(eased)).toBe(eased);
  });
  it("clamps handles so time stays monotonic", () => {
    expect(clampEase([-1, -5, 2, 9])).toEqual([0, -1, 1, 2]);
  });
  it("presets are all valid", () => {
    for (const p of PRESETS) if (p.ease) expect(clampEase(p.ease)).toEqual(p.ease);
  });
});
