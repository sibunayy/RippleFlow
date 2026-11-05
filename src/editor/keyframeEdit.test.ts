import { describe, expect, it } from "vitest";
import type { Composition, Layer, Track } from "../core/types";
import { deleteKeys, isAnimated, keyColumns, moveKeys, snapToFrame } from "./keyframeEdit";

const empty: Track = { keys: [] };
const tr = (...v: [number, number][]): Track => ({ keys: v.map(([t, value], i) => ({ id: `k${t}-${i}`, t, value })) });
const layer: Layer = {
  id: "a",
  name: "A",
  kind: "shape",
  transform: { anchorX: empty, anchorY: empty, x: tr([0, 0], [2, 100]), y: tr([0, 0], [2, 50]), scaleX: empty, scaleY: empty, rotation: tr([1, 0]), opacity: empty },
};
const comp = (): Composition => ({ width: 100, height: 100, fps: 30, duration: 5, layers: [layer] });
const times = (c: Composition, p: "x" | "y" | "rotation") => c.layers[0]!.transform[p].keys.map((k) => k.t);

describe("keyColumns", () => {
  it("groups properties keyed at the same time", () => {
    const cols = keyColumns(layer);
    expect(cols.map((c) => c.t)).toEqual([0, 1, 2]);
    expect(cols[0]!.refs.map((r) => r.prop).sort()).toEqual(["x", "y"]);
    expect(cols[1]!.refs.map((r) => r.prop)).toEqual(["rotation"]);
  });
  it("detects animation", () => {
    expect(isAnimated(layer)).toBe(true);
    expect(isAnimated({ ...layer, transform: { ...layer.transform, x: tr([0, 1]), y: empty, rotation: empty } })).toBe(false);
  });
});

describe("moveKeys", () => {
  it("shifts a column and keeps order", () => {
    const col = keyColumns(layer)[2]!;
    const c = moveKeys(col.refs, 1.5).apply(comp());
    expect(times(c, "x")).toEqual([0, 3.5]);
    expect(times(c, "y")).toEqual([0, 3.5]);
  });
  it("clamps to the composition", () => {
    const col = keyColumns(layer)[2]!;
    expect(times(moveKeys(col.refs, 10).apply(comp()), "x")).toEqual([0, 5]);
    expect(times(moveKeys(keyColumns(layer)[0]!.refs, -3).apply(comp()), "x")).toEqual([0, 2]);
  });
  it("a moved key replaces the key it lands on", () => {
    const col = keyColumns(layer)[0]!; // t=0 -> land on t=2
    const c = moveKeys(col.refs, 2).apply(comp());
    expect(c.layers[0]!.transform.x.keys).toHaveLength(1);
    expect(c.layers[0]!.transform.x.keys[0]!.value).toBe(0); // the moved key wins
  });
  it("zero shift is a no-op (same reference)", () => {
    const c = comp();
    expect(moveKeys(keyColumns(layer)[0]!.refs, 0).apply(c)).toBe(c);
  });
});

describe("deleteKeys and snapToFrame", () => {
  it("deletes only the referenced keys", () => {
    const c = deleteKeys(keyColumns(layer)[1]!.refs).apply(comp());
    expect(times(c, "rotation")).toEqual([]);
    expect(times(c, "x")).toEqual([0, 2]);
  });
  it("snaps to frames", () => {
    expect(snapToFrame(1.02, 30)).toBeCloseTo(1.0333333, 5);
    expect(snapToFrame(1.01, 30)).toBeCloseTo(1, 5);
  });
});

describe("effect and trim keys", () => {
  const rich: Layer = {
    ...layer,
    effects: [{ id: "fx1", type: "blur", values: { radius: tr([0, 0], [1, 20]) } }],
    shape: { path: "M0 0L10 0", trim: { start: tr([0, 0]), end: tr([0, 0], [2, 1]) } },
  };
  const c: Composition = { ...comp(), layers: [rich] };
  it("shows them as diamonds", () => {
    const cols = keyColumns(rich);
    expect(cols.flatMap((x) => x.refs.map((r) => r.prop))).toEqual(expect.arrayContaining(["fx:fx1:radius", "trim:end", "trim:start"]));
    expect(isAnimated({ ...rich, transform: { ...rich.transform, x: empty, y: empty, rotation: empty } })).toBe(true);
  });
  it("moves and deletes them", () => {
    const col = keyColumns(rich).find((x) => x.t === 1 && x.refs.some((r) => r.prop === "fx:fx1:radius"))!;
    const moved = moveKeys(col.refs.filter((r) => r.prop === "fx:fx1:radius"), 0.5).apply(c).layers[0]!;
    expect(moved.effects![0]!.values.radius!.keys.map((k) => k.t)).toEqual([0, 1.5]);
    const gone = deleteKeys(keyColumns(rich).filter((x) => x.t === 2).flatMap((x) => x.refs.filter((r) => r.prop === "trim:end"))).apply(c).layers[0]!;
    expect(gone.shape!.trim!.end.keys.map((k) => k.t)).toEqual([0]);
  });
});
