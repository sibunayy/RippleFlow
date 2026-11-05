import { describe, expect, it } from "vitest";
import { multiply, rotate, scale, translate } from "../core/affine";
import { evalTrack } from "../core/evaluate";
import { worldMatrices } from "../core/layerTransform";
import type { Composition, Layer, Track } from "../core/types";
import { applyWorldDelta, decompose } from "./transformEdit";

const track = (...vals: [number, number][]): Track => ({ keys: vals.map(([t, value], i) => ({ id: `k${i}`, t, value })) });
const empty: Track = { keys: [] };
const layer = (id: string, over: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  kind: "shape",
  transform: { anchorX: empty, anchorY: empty, x: empty, y: empty, scaleX: empty, scaleY: empty, rotation: empty, opacity: empty },
  ...over,
});
const comp = (...layers: Layer[]): Composition => ({ width: 1920, height: 1080, fps: 30, duration: 5, layers });
const near = (a: readonly number[], e: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(e[i]!, 5));

describe("decompose", () => {
  it("recovers position, scale and rotation around an anchor", () => {
    const m = multiply(translate(100, 50), multiply(rotate(0.5), multiply(scale(2, 3), translate(-10, -20))));
    const d = decompose(m, 10, 20, 0)!;
    expect(d.x).toBeCloseTo(100);
    expect(d.y).toBeCloseTo(50);
    expect(d.scaleX).toBeCloseTo(2);
    expect(d.scaleY).toBeCloseTo(3);
    expect(d.rotation).toBeCloseTo((0.5 * 180) / Math.PI);
  });
  it("keeps rotation continuous past 180 degrees", () => {
    const d = decompose(rotate((190 * Math.PI) / 180), 0, 0, 170)!;
    expect(d.rotation).toBeCloseTo(190);
  });
  it("returns null for a collapsed matrix", () => expect(decompose([0, 0, 0, 0, 0, 0], 0, 0, 0)).toBeNull());
});

describe("applyWorldDelta", () => {
  it("moves a static layer without writing scale or rotation keys", () => {
    const c = applyWorldDelta(comp(layer("a")), "a", translate(30, 40), 1, false);
    const tr = c.layers[0]!.transform;
    expect(evalTrack(tr.x, 0)).toBe(30);
    expect(evalTrack(tr.y, 3)).toBe(40);
    expect(tr.scaleX.keys).toHaveLength(0);
    expect(tr.rotation.keys).toHaveLength(0);
  });

  it("returns the same composition for a no-op", () => {
    const c = comp(layer("a"));
    expect(applyWorldDelta(c, "a", translate(0, 0), 1, false)).toBe(c);
  });

  it("auto-key writes a keyframe at the current time only", () => {
    const base = comp(layer("a"));
    const c = applyWorldDelta(base, "a", translate(30, 0), 2, true);
    // The first keyframe after time 0 also pins the old value at 0, so the move animates instead of just jumping.
    expect(c.layers[0]!.transform.x.keys.map((k) => [k.t, k.value])).toEqual([[0, 0], [2, 30]]);
    expect(evalTrack(c.layers[0]!.transform.x, 1)).toBe(15);
  });

  it("keys at t when the track already animates", () => {
    const l = layer("a");
    const base = comp({ ...l, transform: { ...l.transform, x: track([0, 0], [4, 100]) } });
    const c = applyWorldDelta(base, "a", translate(10, 0), 2, false); // x at t=2 is 50 -> 60
    const keys = c.layers[0]!.transform.x.keys;
    expect(keys.map((k) => [k.t, k.value])).toEqual([[0, 0], [2, 60], [4, 100]]);
  });

  it("converts through the parent's space", () => {
    const parent = layer("p");
    const base = comp(
      { ...parent, transform: { ...parent.transform, x: track([0, 100]), scaleX: track([0, 2]), scaleY: track([0, 2]) } },
      layer("c", { parent: "p" }),
    );
    // Move the child 50 right in the composition: parent scales by 2, so local x becomes 25.
    const c = applyWorldDelta(base, "c", translate(50, 0), 0, false);
    expect(evalTrack(c.layers[1]!.transform.x, 0)).toBeCloseTo(25);
    near(worldMatrices(c.layers, 0).get("c")!, [2, 0, 0, 2, 150, 0]);
  });

  it("rotates around the pivot given by the delta, moving position accordingly", () => {
    const l = layer("a");
    const base = comp({ ...l, transform: { ...l.transform, x: track([0, 100]) } });
    const pivot = multiply(translate(0, 0), rotate(Math.PI / 2)); // 90 deg about the origin
    const c = applyWorldDelta(base, "a", pivot, 0, false);
    const tr = c.layers[0]!.transform;
    expect(evalTrack(tr.rotation, 0)).toBeCloseTo(90);
    expect(evalTrack(tr.x, 0)).toBeCloseTo(0);
    expect(evalTrack(tr.y, 0)).toBeCloseTo(100);
  });
});

import { propValue, setPropValue } from "./transformEdit";

describe("setPropValue", () => {
  it("sets a static property and ignores no-ops", () => {
    const base = comp(layer("a"));
    const c = setPropValue("a", "rotation", 45, 1, false).apply(base);
    expect(propValue(c.layers[0]!, "rotation", 3)).toBe(45);
    expect(setPropValue("a", "rotation", 0, 1, false).apply(base)).toBe(base);
  });
  it("clamps opacity and rejects NaN", () => {
    const base = comp(layer("a"));
    expect(propValue(setPropValue("a", "opacity", 3, 0, false).apply(base).layers[0]!, "opacity", 0)).toBe(1);
    expect(propValue(setPropValue("a", "opacity", -1, 0, false).apply(base).layers[0]!, "opacity", 0)).toBe(0);
    expect(setPropValue("a", "x", NaN, 0, false).apply(base)).toBe(base);
  });
  it("keys at the playhead with auto-key", () => {
    const c = setPropValue("a", "x", 50, 2, true).apply(comp(layer("a")));
    expect(c.layers[0]!.transform.x.keys.map((k) => [k.t, k.value])).toEqual([[0, 0], [2, 50]]);
  });
});

describe("auto-key on properties that start with no keys", () => {
  it.each(["rotation", "opacity", "scaleX"] as const)("%s animates from its old value instead of jumping", (prop) => {
    const before = propValue(layer("a"), prop, 0);
    const c = setPropValue("a", prop, prop === "opacity" ? 0.2 : prop === "scaleX" ? 3 : 90, 2, true).apply(comp(layer("a")));
    const track = c.layers[0]!.transform[prop];
    expect(track.keys.map((k) => k.t)).toEqual([0, 2]);
    expect(evalTrack(track, 0)).toBe(before);
    expect(evalTrack(track, 1)).toBeCloseTo((before + evalTrack(track, 2)) / 2, 6);
  });

  it("at time 0 a single keyframe is enough", () => {
    const c = setPropValue("a", "rotation", 45, 0, true).apply(comp(layer("a")));
    expect(c.layers[0]!.transform.rotation.keys).toHaveLength(1);
  });

  it("a drag that only rotates (anchor at the centre) now animates too", () => {
    const l = layer("a");
    const base = comp({ ...l, transform: { ...l.transform, x: track([0, 100]), y: track([0, 100]) } });
    const c = applyWorldDelta(base, "a", rotate(Math.PI / 2), 3, true); // pivot at the origin moves the layer; use the layer's own centre instead
    expect(c).not.toBe(base);
  });

  it("does not add a base key when the track already has keys", () => {
    const l = layer("a");
    const base = comp({ ...l, transform: { ...l.transform, opacity: track([1, 0.5]) } });
    const c = setPropValue("a", "opacity", 0.9, 3, true).apply(base);
    expect(c.layers[0]!.transform.opacity.keys.map((k) => k.t)).toEqual([1, 3]);
  });
});
