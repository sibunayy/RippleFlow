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
    const t = { setScene: vi.fn(), setTransform: vi.fn(), setFrame: vi.fn() };
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

describe("video draws", () => {
  const video = { asset: "0123456789abcdef0123456789abcdef", codedWidth: 1920, codedHeight: 1080, rotation: 90 as const, duration: 4, start: 0 };
  const vlayer: Layer = { ...rect, id: "v", kind: "video", shape: undefined, video };
  const frameA = { tag: "a" } as unknown as VideoFrame;
  const frameB = { tag: "b" } as unknown as VideoFrame;
  const makeVideoCtrl = (frame: () => VideoFrame | undefined) => {
    const c = new EditorController({ width: 1000, height: 500, fps: 30, duration: 5, layers: [] });
    c.execute(addLayer(vlayer));
    c.frameOf = () => {
      const f = frame();
      return f ? { frame: f } : undefined;
    };
    return c;
  };

  it("skips a video layer until its first frame has decoded", () => {
    expect(buildDraws(makeVideoCtrl(() => undefined), 1)).toHaveLength(1); // backdrop only
  });

  it("applies the rotation to the draw and carries the frame", () => {
    const c = makeVideoCtrl(() => frameA);
    const d = buildDraws(c, 1);
    expect(d).toHaveLength(2);
    expect(d[1]!.frame).toBe(frameA);
    // identity view and layer matrix, so the transform is exactly the 90 degree rotation of the coded rectangle
    expect(d[1]!.transform).toEqual([0, 1, -1, 0, 1080, 0]);
  });

  it("a new frame of the same clip swaps the texture only; geometry is not re-uploaded", () => {
    let cur = frameA;
    const c = makeVideoCtrl(() => cur);
    const t = { setScene: vi.fn(), setTransform: vi.fn(), setFrame: vi.fn() };
    const s = new SceneSync();
    expect(s.sync(t, buildDraws(c, 1))).toBe("scene");
    cur = frameB;
    expect(s.sync(t, buildDraws(c, 1))).toBe("transforms");
    expect(t.setScene).toHaveBeenCalledTimes(1);
    expect(t.setFrame).toHaveBeenCalledWith(1, frameB);
  });

  it("the first frame arriving rebuilds the scene (the draw did not exist before)", () => {
    let cur: VideoFrame | undefined;
    const c = makeVideoCtrl(() => cur);
    const t = { setScene: vi.fn(), setTransform: vi.fn(), setFrame: vi.fn() };
    const s = new SceneSync();
    s.sync(t, buildDraws(c, 1));
    cur = frameA;
    expect(s.sync(t, buildDraws(c, 1))).toBe("scene");
  });
});

describe("stroke under non-uniform scale", () => {
  const thickness = (path: string, scaleX: number, scaleY: number, axis: 0 | 1) => {
    const line: Layer = {
      ...rect,
      shape: { path, stroke: { color: [0, 0, 0, 1], width: 10 } },
      transform: { ...rect.transform, scaleX: { keys: [{ id: "a", t: 0, value: scaleX }] }, scaleY: { keys: [{ id: "b", t: 0, value: scaleY }] } },
    };
    const c = new EditorController({ width: 1000, height: 500, fps: 30, duration: 5, layers: [] });
    c.execute(addLayer(line));
    const d = buildDraws(c, 1)[1]!;
    const [a, b, cc, dd, e, f] = d.transform;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < d.mesh.positions.length; i += 2) {
      const x = d.mesh.positions[i]!, y = d.mesh.positions[i + 1]!;
      const v = axis === 0 ? a * x + cc * y + e : b * x + dd * y + f;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return hi - lo;
  };
  it("is as thick across a horizontal line as across a vertical one", () => {
    const h = thickness("M0 0 H100", 4, 1, 1); // across a horizontal line = y extent
    const v = thickness("M0 0 V100", 4, 1, 0); // across a vertical line = x extent
    expect(h).toBeCloseTo(v, 3);
    expect(h).toBeCloseTo(20, 3); // 10 * sqrt(4 * 1)
  });
  it("is unchanged for uniform scale", () => expect(thickness("M0 0 H100", 3, 3, 1)).toBeCloseTo(30, 3));
});
