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
