import { describe, expect, it } from "vitest";
import { apply } from "./affine";
import { evaluateScene } from "./scene";
import type { Composition, Layer, Track, Transform } from "./types";

const K = (value: number): Track => ({ keys: [{ id: `k${value}`, t: 0, value }] });
const NONE: Track = { keys: [] };
const tf = (o: Partial<Transform> = {}): Transform => ({
  anchorX: NONE, anchorY: NONE, x: NONE, y: NONE, scaleX: NONE, scaleY: NONE, rotation: NONE, opacity: NONE, ...o,
});
const layer = (id: string, o: Partial<Layer> = {}): Layer => ({ id, name: id, kind: "shape", transform: tf(), ...o });
const comp = (layers: Layer[], duration = 10): Composition => ({ width: 1920, height: 1080, fps: 30, duration, layers });
const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe("evaluateScene", () => {
  it("returns layers bottom to top in array order", () => {
    const items = evaluateScene(comp([layer("a"), layer("b"), layer("c")]), 0);
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("hides layers outside their in/out range, with the out point exclusive", () => {
    const c = comp([layer("a", { inPoint: 2, outPoint: 4 })]);
    expect(evaluateScene(c, 1.99)).toHaveLength(0);
    expect(evaluateScene(c, 2)).toHaveLength(1);
    expect(evaluateScene(c, 3.99)).toHaveLength(1);
    expect(evaluateScene(c, 4)).toHaveLength(0);
  });
  it("defaults the visible range to the whole composition", () => {
    const c = comp([layer("a")], 5);
    expect(evaluateScene(c, 4.99)).toHaveLength(1);
    expect(evaluateScene(c, 5)).toHaveLength(0);
  });
  it("gives each layer its world matrix, through parents", () => {
    const c = comp([
      layer("p", { transform: tf({ x: K(100), rotation: K(90) }) }),
      layer("c", { parent: "p", transform: tf({ x: K(10) }) }),
    ]);
    const child = evaluateScene(c, 0).find((i) => i.id === "c")!;
    close(apply(child.matrix, 0, 0), [100, 10]);
  });
  it("a visible child still follows a parent that is out of range", () => {
    const c = comp([
      layer("p", { inPoint: 5, outPoint: 6, transform: tf({ x: K(50) }) }),
      layer("c", { parent: "p", transform: tf({ x: K(1) }) }),
    ]);
    const items = evaluateScene(c, 0);
    expect(items.map((i) => i.id)).toEqual(["c"]);
    close(apply(items[0]!.matrix, 0, 0), [51, 0]);
  });
  it("reports opacity per layer", () => {
    const c = comp([layer("a", { transform: tf({ opacity: K(0.25) }) })]);
    expect(evaluateScene(c, 0)[0]!.opacity).toBe(0.25);
  });
  it("is deterministic and does not mutate its input", () => {
    const c = comp([layer("a", { transform: tf({ x: K(3) }) })]);
    const before = JSON.stringify(c);
    expect(evaluateScene(c, 1)).toEqual(evaluateScene(c, 1));
    expect(JSON.stringify(c)).toBe(before);
  });
  it("throws on a parent cycle", () => {
    expect(() => evaluateScene(comp([layer("a", { parent: "b" }), layer("b", { parent: "a" })]), 0)).toThrow(/cycle/i);
  });
});

import { addLayer as _addLayer, sequence, setDuration } from "./commands";
import type { Composition as _Comp, Layer as _Layer } from "./types";

describe("setDuration and sequence", () => {
  const base = (): _Comp => ({ width: 10, height: 10, fps: 30, duration: 6, layers: [] });
  const lay = (id: string): _Layer => ({
    id,
    name: id,
    kind: "shape",
    transform: { anchorX: { keys: [] }, anchorY: { keys: [] }, x: { keys: [] }, y: { keys: [] }, scaleX: { keys: [] }, scaleY: { keys: [] }, rotation: { keys: [] }, opacity: { keys: [] } },
  });
  it("changes the length, ignores a no-op, rejects nonsense", () => {
    expect(setDuration(10).apply(base()).duration).toBe(10);
    const b = base();
    expect(setDuration(6).apply(b)).toBe(b);
    expect(() => setDuration(0).apply(b)).toThrow();
    expect(() => setDuration(NaN).apply(b)).toThrow();
  });
  it("runs commands in order as one step, and a failure changes nothing", () => {
    const c = sequence("both", [setDuration(9), _addLayer(lay("a"))]).apply(base());
    expect(c.duration).toBe(9);
    expect(c.layers.map((l) => l.id)).toEqual(["a"]);
    const b = base();
    expect(() => sequence("bad", [setDuration(9), _addLayer(lay("a")), _addLayer(lay("a"))]).apply(b)).toThrow();
    expect(b.duration).toBe(6); // inputs are immutable, so nothing leaked
  });
});
