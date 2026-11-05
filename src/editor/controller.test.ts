import { describe, expect, it, vi } from "vitest";
import { apply } from "../core/affine";
import { addLayer } from "../core/commands";
import { evalTrack } from "../core/evaluate";
import type { Composition, Layer, Track } from "../core/types";
import { EditorController, type PointerInput } from "./controller";

const empty: Track = { keys: [] };
const rect: Layer = {
  id: "a",
  name: "A",
  kind: "shape",
  shape: { path: "M0 0 H100 V100 H0 Z", fill: [1, 0, 0, 1] },
  transform: { anchorX: empty, anchorY: empty, x: empty, y: empty, scaleX: empty, scaleY: empty, rotation: empty, opacity: empty },
};
const doc = (): Composition => ({ width: 1000, height: 500, fps: 30, duration: 5, layers: [] });
const setup = () => {
  const c = new EditorController(doc());
  c.execute(addLayer(rect));
  c.view = [1, 0, 0, 1, 0, 0];
  return c;
};
const pen = (id: number, x: number, y: number): PointerInput => ({ id, type: "pen", x, y });
const touch = (id: number, x: number, y: number): PointerInput => ({ id, type: "touch", x, y });

describe("EditorController", () => {
  it("fits the composition into the viewport", () => {
    const c = setup();
    c.fitView(1000, 500, 0);
    expect(apply(c.view, 0, 0)).toEqual([0, 0]);
    expect(apply(c.view, 1000, 500)).toEqual([1000, 500]);
    c.fitView(2000, 2000, 0); // width-limited: 2x, centred vertically
    expect(apply(c.view, 0, 0)).toEqual([0, 500]);
  });

  it("selects with the pen and drags with live preview, committing once", () => {
    const c = setup();
    const fn = vi.fn();
    c.subscribe(fn);
    c.pointerDown(pen(1, 50, 50));
    expect(c.selection).toBe("a");
    c.pointerMove(pen(1, 80, 50));
    expect(evalTrack(c.displayed.layers[0]!.transform.x, 0)).toBe(30); // preview
    expect(evalTrack(c.document.layers[0]!.transform.x, 0)).toBe(0); // not committed
    expect(c.canUndo).toBe(true); // only the addLayer so far
    c.pointerUp(pen(1, 90, 50));
    expect(evalTrack(c.document.layers[0]!.transform.x, 0)).toBe(40);
    c.undo();
    expect(evalTrack(c.document.layers[0]!.transform.x, 0)).toBe(0);
    c.undo();
    expect(c.document.layers).toHaveLength(0);
    expect(c.selection).toBeNull(); // selected layer vanished
  });

  it("converts screen to composition coordinates through the view", () => {
    const c = setup();
    c.view = [2, 0, 0, 2, 100, 100]; // zoom 2, panned
    c.pointerDown(pen(1, 100 + 2 * 50, 100 + 2 * 50)); // composition (50,50)
    expect(c.selection).toBe("a");
    c.pointerMove(pen(1, 100 + 2 * 60, 100 + 2 * 50));
    c.pointerUp(pen(1, 100 + 2 * 60, 100 + 2 * 50));
    expect(evalTrack(c.document.layers[0]!.transform.x, 0)).toBe(10);
  });

  it("touch never edits and two fingers navigate", () => {
    const c = setup();
    c.pointerDown(touch(1, 50, 50));
    c.pointerUp(touch(1, 50, 50));
    expect(c.selection).toBeNull();

    c.pointerDown(touch(1, 100, 100));
    c.pointerDown(touch(2, 200, 100));
    c.pointerMove(touch(2, 300, 100)); // spread: zoom 2 about the first finger's midpoint area
    expect(Math.hypot(c.view[0], c.view[1])).toBeCloseTo(1.5 + 0.5, 0);
    expect(c.document.layers[0]!.transform.x.keys).toHaveLength(0);
  });

  it("a finger landing mid-drag cancels the drag without committing", () => {
    const c = setup();
    c.pointerDown(pen(1, 50, 50));
    c.pointerMove(pen(1, 90, 50));
    c.pointerDown(touch(7, 400, 400)); // palm
    c.pointerUp(pen(1, 90, 50));
    expect(c.displayed).toBe(c.document);
    expect(evalTrack(c.document.layers[0]!.transform.x, 0)).toBe(0);
  });

  it("auto-key writes a keyframe at the playhead", () => {
    const c = setup();
    c.autoKey = true;
    c.setTime(2);
    c.pointerDown(pen(1, 50, 50));
    c.pointerMove(pen(1, 70, 50));
    c.pointerUp(pen(1, 70, 50));
    expect(c.document.layers[0]!.transform.x.keys.map((k) => [k.t, k.value])).toEqual([[0, 0], [2, 20]]); // old value pinned at 0, so the move animates
  });
});
