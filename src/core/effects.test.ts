import { describe, expect, it } from "vitest";
import { addEffect, moveEffect, removeEffect } from "./commands";
import { EFFECTS, newEffect, resolveEffects, scaleSpatial } from "./effects";
import type { Composition, Layer, Track } from "./types";
import { setEffectValue } from "../editor/effectEdit";
import { deserialize, serialize } from "../persist/serialize";

const e: Track = { keys: [] };
const layer: Layer = { id: "a", name: "a", kind: "shape", shape: { path: "M0 0 H1 V1 Z", fill: [1, 0, 0, 1] }, transform: { anchorX: e, anchorY: e, x: e, y: e, scaleX: e, scaleY: e, rotation: e, opacity: e } };
const comp: Composition = { width: 10, height: 10, fps: 30, duration: 4, layers: [layer] };
const fxOf = (c: Composition) => c.layers[0]!.effects!;

describe("effects model", () => {
  it("every effect has defaults inside its ranges", () => {
    for (const s of EFFECTS) for (const p of s.params) expect(p.def >= p.min && p.def <= p.max, `${s.type}.${p.key}`).toBe(true);
  });
  it("adds, reorders and removes", () => {
    let c = addEffect("a", newEffect("blur", "f1")).apply(comp);
    c = addEffect("a", newEffect("invert", "f2")).apply(c);
    expect(fxOf(c).map((x) => x.id)).toEqual(["f1", "f2"]);
    c = moveEffect("a", "f2", 0).apply(c);
    expect(fxOf(c).map((x) => x.id)).toEqual(["f2", "f1"]);
    c = removeEffect("a", "f2").apply(removeEffect("a", "f1").apply(c));
    expect(c.layers[0]!.effects).toBeUndefined();
    expect(() => addEffect("a", newEffect("blur", "f1")).apply(addEffect("a", newEffect("blur", "f1")).apply(comp))).toThrow(/already/);
  });
  it("resolves values at a time and skips disabled effects", () => {
    const c = addEffect("a", { ...newEffect("blur", "f1"), enabled: false }).apply(comp);
    expect(resolveEffects(c.layers[0]!, 0)).toEqual([]);
    const on = addEffect("a", newEffect("blur", "f2")).apply(comp);
    expect(resolveEffects(on.layers[0]!, 1)[0]!.v.radius).toBe(12);
  });
  it("values clamp to range and can be keyframed", () => {
    let c = addEffect("a", newEffect("blur", "f1")).apply(comp);
    c = setEffectValue("a", "f1", "radius", 9999, 0, false).apply(c);
    expect(resolveEffects(c.layers[0]!, 0)[0]!.v.radius).toBe(300);
    c = setEffectValue("a", "f1", "radius", 0, 2, true).apply(c);
    c = setEffectValue("a", "f1", "radius", 100, 4, true).apply(c);
    expect(resolveEffects(c.layers[0]!, 3)[0]!.v.radius).toBeCloseTo(50);
  });
  it("scales spatial values only", () => {
    const f = scaleSpatial(resolveEffects(addEffect("a", newEffect("dropShadow", "s")).apply(comp).layers[0]!, 0)[0]!, 2);
    expect(f.v.distance).toBe(48);
    expect(f.v.opacity).toBe(0.6);
  });
  it("survives save and load, and rejects unknown effects", () => {
    const c = addEffect("a", newEffect("glow", "g")).apply(comp);
    expect(deserialize(serialize(c)).layers[0]!.effects).toEqual(fxOf(c));
    const bad = JSON.parse(serialize(c));
    bad.composition.layers[0].effects[0].type = "sparkles";
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/known effect/);
  });
});
