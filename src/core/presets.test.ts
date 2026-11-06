import { describe, expect, it } from "vitest";
import { evalTrack } from "./evaluate";
import { History } from "./history";
import { applyPreset, clearPreset, detectPreset, PRESETS } from "./presets";
import { sequence } from "./commands";
import { newShapeLayer } from "../app/shapes";
import type { Composition } from "./types";

const comp = (): Composition => ({
  width: 1920, height: 1080, fps: 30, duration: 4, background: [1, 1, 1, 1],
  layers: [newShapeLayer("rect", 1, 1920, 1080)],
} as Composition);

const run = (id: string, c = comp()) => applyPreset("layer-1", id, c.duration).apply(c);
const L = (c: Composition) => c.layers[0]!;

describe("presets", () => {
  it("fade in: transparent at the in-point, original opacity after the span", () => {
    const c = run("fade-in");
    expect(evalTrack(L(c).transform.opacity, 0, 1)).toBe(0);
    expect(evalTrack(L(c).transform.opacity, 0.5, 1)).toBe(1);
    expect(evalTrack(L(c).transform.opacity, 3, 1)).toBe(1);
    const mid = evalTrack(L(c).transform.opacity, 0.25, 1);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(1);
  });
  it("pop in is relative to the existing scale and overshoots", () => {
    const base = comp();
    const l = { ...L(base), transform: { ...L(base).transform, scaleX: { keys: [{ id: "s", t: 0, value: 2 }] } } };
    const c = run("pop-in", { ...base, layers: [l] });
    expect(evalTrack(L(c).transform.scaleX, 0, 1)).toBe(0);
    expect(evalTrack(L(c).transform.scaleX, 0.5 * 0.65, 1)).toBeCloseTo(2.24, 1);
    expect(evalTrack(L(c).transform.scaleX, 2, 1)).toBeCloseTo(2);
  });
  it("slide up moves up into the original position", () => {
    const c = run("slide-up");
    const y = L(comp()).transform.y.keys[0]!.value;
    expect(evalTrack(L(c).transform.y, 0, 0)).toBeCloseTo(y + 160);
    expect(evalTrack(L(c).transform.y, 1, 0)).toBeCloseTo(y);
  });
  it("out presets end at the out-point and hold earlier values", () => {
    const base = comp();
    const c = run("fade-out", { ...base, layers: [{ ...L(base), outPoint: 3 }] });
    expect(evalTrack(L(c).transform.opacity, 1, 1)).toBe(1);
    expect(evalTrack(L(c).transform.opacity, 3, 1)).toBe(0);
  });
  it("in then out on one layer, shortened when the clip is short, and undoable", () => {
    const h = new History(comp());
    h.execute(applyPreset("layer-1", "fade-in", 4));
    h.execute(applyPreset("layer-1", "fade-out", 4));
    const o = L(h.current).transform.opacity;
    expect(evalTrack(o, 0, 1)).toBe(0);
    expect(evalTrack(o, 2, 1)).toBe(1);
    expect(evalTrack(o, 4, 1)).toBe(0);
    h.undo();
    expect(evalTrack(L(h.current).transform.opacity, 4, 1)).toBe(1);
    const short = applyPreset("layer-1", "fade-in", 4).apply({ ...comp(), layers: [{ ...L(comp()), inPoint: 1, outPoint: 1.2 }] });
    expect(L(short).transform.opacity.keys.at(-1)!.t).toBeCloseTo(1.2);
  });
  it("applying twice replaces rather than stacks", () => {
    const once = run("pop-in");
    const twice = applyPreset("layer-1", "pop-in", 4).apply(once);
    expect(L(twice).transform.scaleX.keys.length).toBe(L(once).transform.scaleX.keys.length);
  });
  it("every preset applies cleanly", () => {
    for (const p of PRESETS) expect(() => run(p.id)).not.toThrow();
  });
});

describe("staggered children", () => {
  it("delays each child's start by index and keeps their ranges", async () => {
    const { applyPresetToChildren } = await import("./presets");
    const base = comp();
    const mk = (id: string) => ({ ...L(base), id, parent: "g" });
    const c: Composition = { ...base, layers: [{ ...L(base), id: "g", name: "g" }, mk("k1"), mk("k2"), mk("k3")] };
    const out = applyPresetToChildren("g", "fade-in", 4, 0.25).apply(c);
    const op = (id: string) => out.layers.find((l) => l.id === id)!.transform.opacity;
    expect(evalTrack(op("k1"), 0, 1)).toBe(0);
    expect(evalTrack(op("k1"), 0.5, 1)).toBe(1);
    expect(evalTrack(op("k3"), 0.5, 1)).toBe(0); // third child starts at 0.5s
    expect(evalTrack(op("k3"), 1.0, 1)).toBe(1);
    expect(out.layers[0]!.transform.opacity.keys.length).toBe(0);
    expect(out.layers[3]!.inPoint).toBeUndefined();
  });
  it("out presets finish earlier for later children", async () => {
    const { applyPresetToChildren } = await import("./presets");
    const base = comp();
    const mk = (id: string) => ({ ...L(base), id, parent: "g" });
    const c: Composition = { ...base, layers: [{ ...L(base), id: "g" }, mk("k1"), mk("k2")] };
    const out = applyPresetToChildren("g", "fade-out", 4, 0.5).apply(c);
    const op = (id: string) => out.layers.find((l) => l.id === id)!.transform.opacity;
    expect(evalTrack(op("k1"), 4, 1)).toBe(0);
    expect(evalTrack(op("k2"), 4, 1)).toBe(0);
    expect(evalTrack(op("k2"), 3.4, 1)).toBeLessThan(1); // already fading
    expect(evalTrack(op("k1"), 3.75, 1)).toBeLessThan(1);
    expect(evalTrack(op("k1"), 3.4, 1)).toBe(1); // first child starts last
    expect(evalTrack(op("k2"), 3.0, 1)).toBe(1);
  });
});

describe("preset detection", () => {
  it("recognises each preset it wrote, in and out independently", () => {
    for (const p of PRESETS) {
      const c = run(p.id);
      expect(detectPreset(L(c), p.kind, c.duration)).toBe(p.id);
      expect(detectPreset(L(c), p.kind === "in" ? "out" : "in", c.duration)).toBeNull();
    }
  });
  it("switching presets via clear + apply leaves only the new one", () => {
    const pop = run("pop-in");
    const c = sequence("swap", [clearPreset("layer-1", "in", 4), applyPreset("layer-1", "fade-in", 4)]).apply(pop);
    expect(detectPreset(L(c), "in", 4)).toBe("fade-in");
    expect(evalTrack(L(c).transform.scaleX, 0, 1)).toBe(1);
  });
  it("clearing returns the property to its settled value", () => {
    const c = clearPreset("layer-1", "in", 4).apply(run("slide-up"));
    expect(detectPreset(L(c), "in", 4)).toBeNull();
    expect(evalTrack(L(c).transform.y, 0, 0)).toBe(540);
    expect(evalTrack(L(c).transform.opacity, 0, 1)).toBe(1);
  });
  it("a hand-made animation is not a preset", () => {
    expect(detectPreset(L(comp()), "in", 4)).toBeNull();
  });
});
