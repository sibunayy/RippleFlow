import { describe, expect, it } from "vitest";
import { History } from "../core/history";
import { evaluateScene } from "../core/scene";
import { serialize, deserialize } from "../persist/serialize";
import type { Composition, Layer } from "../core/types";
import { setTrim, trimValue } from "./trimEdit";

const still = (v: number) => ({ keys: [{ id: `s${v}`, t: 0, value: v }] });
const layer: Layer = {
  id: "a", name: "a", kind: "shape",
  shape: { path: "M0 0 H100", stroke: { color: [1, 1, 1, 1], width: 4 } },
  transform: { anchorX: still(0), anchorY: still(0), x: still(0), y: still(0), scaleX: { keys: [] }, scaleY: { keys: [] }, rotation: { keys: [] }, opacity: { keys: [] } },
};
const comp: Composition = { width: 200, height: 100, fps: 30, duration: 2, background: [0, 0, 0, 1], layers: [layer] } as Composition;

describe("trim paths", () => {
  it("keyframes end from 0 to 1 and the scene reports it", () => {
    const h = new History(comp);
    h.execute(setTrim("a", "end", 0, 0, true));
    h.execute(setTrim("a", "end", 1, 1, true));
    const at = (t: number) => evaluateScene(h.current, t)[0]!.trim!;
    expect(at(0).end).toBe(0);
    expect(at(0.5).end).toBeCloseTo(0.5);
    expect(at(1).end).toBe(1);
    expect(at(0.5).start).toBe(0);
    expect(trimValue(h.current.layers[0]!.shape!, "end", 0.25)).toBeCloseTo(0.25);
  });
  it("untouched shapes report no trim; static edit without auto-key holds everywhere", () => {
    expect(evaluateScene(comp, 0)[0]!.trim).toBeUndefined();
    const c = setTrim("a", "start", 0.3, 0.7, false).apply(comp);
    expect(evaluateScene(c, 0)[0]!.trim!.start).toBeCloseTo(0.3);
    expect(evaluateScene(c, 1.9)[0]!.trim!.start).toBeCloseTo(0.3);
  });
  it("survives save and load", () => {
    const c = setTrim("a", "end", 0.4, 0, false).apply(comp);
    const back = deserialize(serialize(c));
    expect(back.layers[0]!.shape!.trim!.end.keys[0]!.value).toBeCloseTo(0.4);
  });
});
