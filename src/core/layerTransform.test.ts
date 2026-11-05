import { describe, expect, it } from "vitest";
import { apply } from "./affine";
import { localMatrix, opacityAt, worldMatrix } from "./layerTransform";
import type { Layer, Track, Transform } from "./types";

const K = (value: number): Track => ({ keys: [{ id: `k${value}`, t: 0, value }] });
const NONE: Track = { keys: [] };
const tf = (o: Partial<Transform> = {}): Transform => ({
  anchorX: NONE, anchorY: NONE, x: NONE, y: NONE, scaleX: NONE, scaleY: NONE, rotation: NONE, opacity: NONE, ...o,
});
const layer = (id: string, transform: Transform, parent?: string): Layer => ({
  id, name: id, kind: "shape", transform, ...(parent ? { parent } : {}),
});
const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe("localMatrix", () => {
  it("is the identity with no keys", () => {
    close(localMatrix(layer("a", tf()), 0), [1, 0, 0, 1, 0, 0]);
  });
  it("places the anchor at the position", () => {
    const m = localMatrix(layer("a", tf({ anchorX: K(10), anchorY: K(20), x: K(100), y: K(200) })), 0);
    close(apply(m, 10, 20), [100, 200]);
  });
  it("rotates about the anchor, not the origin", () => {
    // Anchor (10, 0) pinned at (10, 0). A point 5 to its right turns to 5 below it at +90 degrees.
    const m = localMatrix(layer("a", tf({ anchorX: K(10), x: K(10), rotation: K(90) })), 0);
    close(apply(m, 10, 0), [10, 0]);
    close(apply(m, 15, 0), [10, 5]);
  });
  it("scales about the anchor", () => {
    const m = localMatrix(layer("a", tf({ anchorX: K(10), x: K(10), scaleX: K(2) })), 0);
    close(apply(m, 15, 0), [20, 0]);
  });
  it("animates over time", () => {
    const t: Track = { keys: [{ id: "a", t: 0, value: 0 }, { id: "b", t: 2, value: 100 }] };
    close(localMatrix(layer("a", tf({ x: t })), 1), [1, 0, 0, 1, 50, 0]);
  });
});

describe("worldMatrix", () => {
  it("a child inherits its parent's translation and rotation", () => {
    const parent = layer("p", tf({ x: K(100), y: K(0), rotation: K(90) }));
    const child = layer("c", tf({ x: K(10), y: K(0) }), "p");
    // Child's own +10 x offset is rotated by the parent's 90 degrees, then moved to (100, 0).
    close(apply(worldMatrix([parent, child], "c", 0), 0, 0), [100, 10]);
  });
  it("follows a three-level chain", () => {
    const a = layer("a", tf({ x: K(1) }));
    const b = layer("b", tf({ x: K(2) }), "a");
    const c = layer("c", tf({ x: K(4) }), "b");
    close(apply(worldMatrix([a, b, c], "c", 0), 0, 0), [7, 0]);
  });
  it("throws on a parent cycle", () => {
    const a = layer("a", tf(), "b");
    const b = layer("b", tf(), "a");
    expect(() => worldMatrix([a, b], "a", 0)).toThrow(/cycle/i);
  });
  it("throws on a missing parent or unknown layer", () => {
    expect(() => worldMatrix([layer("a", tf(), "ghost")], "a", 0)).toThrow(/missing parent/i);
    expect(() => worldMatrix([], "nope", 0)).toThrow(/Unknown layer/);
  });
});

describe("opacityAt", () => {
  it("defaults to 1 and clamps to 0..1", () => {
    expect(opacityAt(layer("a", tf()), 0)).toBe(1);
    expect(opacityAt(layer("a", tf({ opacity: K(1.5) })), 0)).toBe(1);
    expect(opacityAt(layer("a", tf({ opacity: K(-1) })), 0)).toBe(0);
  });
  it("is not inherited from the parent", () => {
    const p = layer("p", tf({ opacity: K(0) }));
    const c = layer("c", tf(), "p");
    expect(opacityAt(c, 0)).toBe(1);
    void p;
  });
});
