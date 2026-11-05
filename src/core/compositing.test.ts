import { describe, expect, it } from "vitest";
import { addMask, patchMask, removeMask, sequence, setHidden, setMatte } from "./commands";
import { evaluateScene } from "./scene";
import type { Composition, Layer, Track } from "./types";
import { maskPresetPath, newMask, setMaskFeather, setMaskInverted, setMaskMode, setMaskOpacity } from "../editor/maskEdit";
import { deserialize, serialize } from "../persist/serialize";
import { nodesToPath, parseNodes } from "../geometry/nodes";

const e: Track = { keys: [] };
const mk = (id: string, extra: Partial<Layer> = {}): Layer => ({ id, name: id, kind: "shape", shape: { path: "M0 0 H10 V10 Z", fill: [1, 0, 0, 1] }, transform: { anchorX: e, anchorY: e, x: e, y: e, scaleX: e, scaleY: e, rotation: e, opacity: e }, ...extra });
const comp: Composition = { width: 100, height: 100, fps: 30, duration: 4, layers: [mk("a"), mk("b")] };

describe("visibility and mattes", () => {
  it("hidden layers are not in the scene but still serve as a matte", () => {
    let c = sequence("m", [setMatte("a", { source: "b", mode: "alpha" }), setHidden("b", true)]).apply(comp);
    const items = evaluateScene(c, 1);
    expect(items.map((i) => i.id)).toEqual(["a"]);
    expect(items[0]!.matte?.source?.id).toBe("b");
    c = setHidden("b", false).apply(c);
    expect(evaluateScene(c, 1)).toHaveLength(2);
  });
  it("matte source outside its in/out range gives an empty matte", () => {
    const c = setMatte("a", { source: "b", mode: "luma" }).apply({ ...comp, layers: [comp.layers[0]!, mk("b", { outPoint: 1 })] });
    expect(evaluateScene(c, 2).find((i) => i.id === "a")!.matte!.source).toBeNull();
  });
  it("refuses a layer as its own matte and unknown sources", () => {
    expect(() => setMatte("a", { source: "a", mode: "alpha" }).apply(comp)).toThrow();
    expect(() => setMatte("a", { source: "zzz", mode: "alpha" }).apply(comp)).toThrow();
  });
  it("clears a matte", () => {
    const c = setMatte("a", { source: "b", mode: "alpha" }).apply(comp);
    expect(setMatte("a", undefined).apply(c).layers[0]!.matte).toBeUndefined();
  });
  it("round-trips and rejects dangling matte sources", () => {
    const c = setMatte("a", { source: "b", mode: "lumaInverted" }).apply(setHidden("b", true).apply(comp));
    expect(deserialize(serialize(c)).layers[0]!.matte).toEqual({ source: "b", mode: "lumaInverted" });
    expect(deserialize(serialize(c)).layers[1]!.hidden).toBe(true);
    const bad = JSON.parse(serialize(c));
    bad.composition.layers[0].matte.source = "zzz";
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/matte/);
  });
});

describe("masks", () => {
  const path = maskPresetPath("rect", { x: 0, y: 0, w: 100, h: 50 });
  it("adds, edits and removes masks", () => {
    let c = addMask("a", newMask("m1", path)).apply(comp);
    c = setMaskMode("a", "m1", "subtract").apply(c);
    c = setMaskFeather("a", "m1", -5).apply(c);
    c = setMaskOpacity("a", "m1", 3).apply(c);
    c = setMaskInverted("a", "m1", true).apply(c);
    expect(c.layers[0]!.masks![0]).toMatchObject({ mode: "subtract", feather: 0, opacity: 1, inverted: true });
    expect(evaluateScene(c, 0)[0]!.masks).toHaveLength(1);
    expect(() => addMask("a", newMask("m1", path)).apply(c)).toThrow(/already/);
    expect(removeMask("a", "m1").apply(c).layers[0]!.masks).toBeUndefined();
    expect(() => patchMask("a", "nope", "x", (m) => m).apply(c)).toThrow();
  });
  it("preset paths cover the inset box, and the ellipse is four smooth nodes", () => {
    const rect = parseNodes(path)[0]!;
    expect(rect.nodes).toHaveLength(4);
    expect(rect.nodes[0]).toMatchObject({ x: 10, y: 5 });
    const ell = parseNodes(maskPresetPath("ellipse", { x: 0, y: 0, w: 100, h: 100 }))[0]!;
    expect(ell.nodes).toHaveLength(4);
    expect(nodesToPath([ell])).toContain("C");
  });
  it("round-trips and validates", () => {
    const c = addMask("a", { ...newMask("m1", path), feather: 4, inverted: true }).apply(comp);
    expect(deserialize(serialize(c)).layers[0]!.masks).toEqual(c.layers[0]!.masks);
    const bad = JSON.parse(serialize(c));
    bad.composition.layers[0].masks[0].opacity = 2;
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/opacity/);
  });
});
