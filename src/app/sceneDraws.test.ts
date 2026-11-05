import { describe, expect, it, vi } from "vitest";
import { addLayer } from "../core/commands";
import type { Layer, Track } from "../core/types";
import { EditorController } from "../editor/controller";
import { buildDraws, SceneSync, selectionCorners } from "./sceneDraws";

const empty: Track = { keys: [] };
const rect: Layer = {
  id: "a",
  name: "A",
  kind: "shape",
  shape: { path: "M0 0 H100 V50 H0 Z", fill: [1, 0, 0, 1], stroke: { color: [0, 0, 0, 1], width: 4 } },
  transform: { anchorX: empty, anchorY: empty, x: empty, y: empty, scaleX: empty, scaleY: empty, rotation: empty, opacity: empty },
};
const make = () => {
  const c = new EditorController({ width: 1000, height: 500, fps: 30, duration: 5, layers: [] });
  c.execute(addLayer(rect));
  return c;
};

describe("buildDraws", () => {
  it("emits fill then stroke, with view and device scale applied", () => {
    const c = make();
    c.view = [2, 0, 0, 2, 10, 20];
    const d = buildDraws(c, 2);
    expect(d).toHaveLength(3); // backdrop, fill, stroke
    expect(d[0]!.color).toEqual([1, 1, 1, 1]); // default white backdrop
    expect(d[1]!.color).toEqual([1, 0, 0, 1]);
    expect(d[1]!.transform).toEqual([4, 0, 0, 4, 20, 40]);
  });
});

describe("SceneSync", () => {
  it("re-uploads only when meshes change", () => {
    const c = make();
    const t = { setScene: vi.fn(), setTransform: vi.fn() };
    const s = new SceneSync();
    expect(s.sync(t, buildDraws(c, 1))).toBe("scene");
    c.view = [3, 0, 0, 3, 0, 0];
    expect(s.sync(t, buildDraws(c, 1))).toBe("transforms");
    expect(t.setScene).toHaveBeenCalledTimes(1);
    expect(t.setTransform).toHaveBeenCalledTimes(3);
  });
});

describe("selectionCorners", () => {
  it("is null with no selection and tracks the view otherwise", () => {
    const c = make();
    expect(selectionCorners(c)).toBeNull();
    c.setSelection("a");
    c.view = [2, 0, 0, 2, 0, 0];
    const k = selectionCorners(c)!;
    expect(k[0]).toEqual([-4, -4]); // stroke reach: 2px each side, doubled by the view
    expect(k[2]).toEqual([204, 104]);
  });
});
