import { describe, expect, it } from "vitest";
import { apply, IDENTITY, translate } from "../core/affine";
import type { SceneItem } from "../core/scene";
import { SelectTool, type ToolContext, type ToolEvent } from "./selectTool";

const item = (id: string, matrix = IDENTITY): SceneItem => ({ id, kind: "shape", matrix, opacity: 1, blend: "normal" });
const ctx = (items: SceneItem[]): ToolContext => ({
  items,
  boundsOf: () => ({ x: 0, y: 0, w: 100, h: 100 }),
  unitsPerPx: 1,
});
const pen = (x: number, y: number, shift = false): ToolEvent => ({ pointerType: "pen", x, y, shift });
const touch = (x: number, y: number): ToolEvent => ({ pointerType: "touch", x, y });

describe("SelectTool", () => {
  it("selects on tap and clears on empty space", () => {
    const t = new SelectTool();
    const c = ctx([item("a")]);
    expect(t.down(1, pen(50, 50), c)).toEqual({ select: "a" });
    expect(t.up(1, pen(50, 50), c)).toEqual({});
    expect(t.down(1, pen(500, 500), c)).toEqual({ select: null });
    expect(t.selection).toBeNull();
  });

  it("ignores touch entirely", () => {
    const t = new SelectTool();
    expect(t.down(1, touch(50, 50), ctx([item("a")]))).toEqual({});
    expect(t.selection).toBeNull();
  });

  it("does not drag until past the threshold, then reports total deltas", () => {
    const t = new SelectTool();
    const c = ctx([item("a")]);
    t.down(1, pen(50, 50), c);
    expect(t.move(1, pen(51, 50), c)).toEqual({});
    const out = t.move(1, pen(70, 60), c);
    expect(out.drag?.kind).toBe("move");
    expect(apply(out.drag!.delta, 0, 0)).toEqual([20, 10]);
    const end = t.up(1, pen(80, 60), c);
    expect(end.drag?.final).toBe(true);
    expect(apply(end.drag!.delta, 0, 0)).toEqual([30, 10]);
    expect(t.dragging).toBe(false);
  });

  it("shift locks movement to one axis", () => {
    const t = new SelectTool();
    const c = ctx([item("a")]);
    t.down(1, pen(50, 50), c);
    const out = t.move(1, pen(90, 55, true), c);
    expect(apply(out.drag!.delta, 0, 0)).toEqual([40, 0]);
  });

  it("scales from a corner handle of the selected layer", () => {
    const t = new SelectTool();
    const c = ctx([item("a")]);
    t.setSelection("a");
    t.down(1, pen(100, 100), c);
    const out = t.move(1, pen(200, 200), c);
    expect(out.drag?.kind).toBe("scale");
    expect(apply(out.drag!.delta, 100, 100)).toEqual([200, 200]);
  });

  it("rotates from just outside a corner", () => {
    const t = new SelectTool();
    const c = ctx([item("a")]);
    t.setSelection("a");
    t.down(1, pen(120, 120), c); // outside the box, within the rotate band
    const out = t.move(1, pen(30, 130), c);
    expect(out.drag?.kind).toBe("rotate");
  });

  it("only follows the pointer that started the drag", () => {
    const t = new SelectTool();
    const c = ctx([item("a")]);
    t.down(1, pen(50, 50), c);
    expect(t.down(2, pen(10, 10), c)).toEqual({});
    expect(t.move(2, pen(90, 90), c)).toEqual({});
  });

  it("cancel aborts without a commit", () => {
    const t = new SelectTool();
    const c = ctx([item("a", translate(0, 0))]);
    t.down(1, pen(50, 50), c);
    t.move(1, pen(80, 80), c);
    t.cancel();
    expect(t.up(1, pen(80, 80), c)).toEqual({});
  });
});
