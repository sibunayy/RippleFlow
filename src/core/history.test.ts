import { describe, expect, it } from "vitest";
import { addLayer, moveLayerInTime, setBackground, setCanvas, duplicateLayer, renameLayer, moveLayer, removeKeyframe, removeLayer, setInOut, setKeyframe, setParent } from "./commands";
import { History } from "./history";
import type { Composition, Layer, Track, Transform } from "./types";

const NONE: Track = { keys: [] };
const tf = (): Transform => ({ anchorX: NONE, anchorY: NONE, x: NONE, y: NONE, scaleX: NONE, scaleY: NONE, rotation: NONE, opacity: NONE });
const layer = (id: string, parent?: string): Layer => ({ id, name: id, kind: "shape", transform: tf(), ...(parent ? { parent } : {}) });
const empty: Composition = { width: 1920, height: 1080, fps: 30, duration: 10, layers: [] };
const ids = (c: Composition) => c.layers.map((l) => l.id);

describe("History", () => {
  it("undoes and redoes edits", () => {
    const h = new History(empty);
    h.execute(addLayer(layer("a")));
    h.execute(addLayer(layer("b")));
    expect(ids(h.current)).toEqual(["a", "b"]);
    h.undo();
    expect(ids(h.current)).toEqual(["a"]);
    h.redo();
    expect(ids(h.current)).toEqual(["a", "b"]);
  });
  it("a new edit clears the redo stack", () => {
    const h = new History(empty);
    h.execute(addLayer(layer("a")));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.execute(addLayer(layer("b")));
    expect(h.canRedo).toBe(false);
  });
  it("undo and redo at the ends do nothing", () => {
    const h = new History(empty);
    expect(h.undo()).toBe(empty);
    expect(h.redo()).toBe(empty);
  });
  it("a command that throws leaves history untouched", () => {
    const h = new History(empty);
    h.execute(addLayer(layer("a")));
    expect(() => h.execute(setParent("a", "ghost"))).toThrow();
    expect(ids(h.current)).toEqual(["a"]);
    h.undo();
    expect(ids(h.current)).toEqual([]);
  });
  it("a no-op edit does not add an undo step", () => {
    const h = new History(empty);
    h.execute(addLayer(layer("a")));
    h.execute(moveLayer("a", 0));
    expect(h.undoLabel).toBe("Add layer a");
    h.undo();
    expect(ids(h.current)).toEqual([]);
  });
  it("caps the undo depth", () => {
    const h = new History(empty, 3);
    for (const id of ["a", "b", "c", "d", "e"]) h.execute(addLayer(layer(id)));
    let steps = 0;
    while (h.canUndo) {
      h.undo();
      steps++;
    }
    expect(steps).toBe(3);
  });
  it("never mutates a previous composition", () => {
    const h = new History(empty);
    const before = h.current;
    h.execute(addLayer(layer("a")));
    expect(before.layers).toHaveLength(0);
  });
});

describe("commands", () => {
  const withLayers = (...ls: Layer[]): Composition => ({ ...empty, layers: ls });

  it("addLayer inserts at an index and rejects duplicate ids", () => {
    const c = addLayer(layer("x"), 1).apply(withLayers(layer("a"), layer("b")));
    expect(ids(c)).toEqual(["a", "x", "b"]);
    expect(() => addLayer(layer("a")).apply(c)).toThrow(/already exists/);
  });
  it("moveLayer reorders and clamps", () => {
    const c = withLayers(layer("a"), layer("b"), layer("c"));
    expect(ids(moveLayer("a", 99).apply(c))).toEqual(["b", "c", "a"]);
    expect(ids(moveLayer("c", 0).apply(c))).toEqual(["c", "a", "b"]);
  });
  it("setParent rejects cycles, including self-parenting", () => {
    const c = withLayers(layer("a"), layer("b", "a"), layer("c", "b"));
    expect(() => setParent("a", "c").apply(c)).toThrow(/cycle/);
    expect(() => setParent("a", "a").apply(c)).toThrow(/cycle/);
    expect(setParent("c", "a").apply(c).layers.find((l) => l.id === "c")!.parent).toBe("a");
  });
  it("setParent can clear a parent", () => {
    const c = withLayers(layer("a"), layer("b", "a"));
    expect(setParent("b", undefined).apply(c).layers[1]!.parent).toBeUndefined();
  });
  it("removeLayer re-attaches children to the grandparent", () => {
    const c = withLayers(layer("g"), layer("p", "g"), layer("k", "p"));
    const out = removeLayer("p").apply(c);
    expect(ids(out)).toEqual(["g", "k"]);
    expect(out.layers[1]!.parent).toBe("g");
    const top = removeLayer("g").apply(withLayers(layer("g"), layer("p", "g")));
    expect(top.layers[0]!.parent).toBeUndefined();
  });
  it("setKeyframe keeps keys sorted and replaces a key at the same time", () => {
    let c = withLayers(layer("a"));
    c = setKeyframe("a", "x", { id: "k2", t: 2, value: 20 }).apply(c);
    c = setKeyframe("a", "x", { id: "k1", t: 1, value: 10 }).apply(c);
    c = setKeyframe("a", "x", { id: "k1b", t: 2, value: 99 }).apply(c);
    expect(c.layers[0]!.transform.x.keys.map((k) => [k.t, k.value])).toEqual([[1, 10], [2, 99]]);
  });
  it("removeKeyframe removes by id and ignores unknown ids", () => {
    let c = setKeyframe("a", "x", { id: "k", t: 0, value: 1 }).apply(withLayers(layer("a")));
    expect(removeKeyframe("a", "x", "nope").apply(c)).toBe(c);
    c = removeKeyframe("a", "x", "k").apply(c);
    expect(c.layers[0]!.transform.x.keys).toHaveLength(0);
  });
  it("setInOut validates the range", () => {
    const c = withLayers(layer("a"));
    expect(setInOut("a", 1, 3).apply(c).layers[0]).toMatchObject({ inPoint: 1, outPoint: 3 });
    expect(() => setInOut("a", 3, 3).apply(c)).toThrow();
  });
  it("commands reject unknown layers", () => {
    expect(() => setKeyframe("nope", "x", { id: "k", t: 0, value: 1 }).apply(empty)).toThrow(/Unknown layer/);
  });
});

describe("duplicateLayer and renameLayer", () => {
  const withKeys = (id: string): Layer => ({ ...layer(id), transform: { ...tf(), x: { keys: [{ id: "k1", t: 0, value: 1 }, { id: "k2", t: 1, value: 2 }] } } });
  it("copies above the original with fresh keyframe ids", () => {
    const c: Composition = { width: 100, height: 100, fps: 30, duration: 1, layers: [withKeys("a"), layer("b")] };
    const out = duplicateLayer("a", "a2").apply(c);
    expect(out.layers.map((l) => l.id)).toEqual(["a", "a2", "b"]);
    expect(out.layers[1]!.name).toBe("a copy");
    const ids = [...out.layers[0]!.transform.x.keys, ...out.layers[1]!.transform.x.keys].map((k) => k.id);
    expect(new Set(ids).size).toBe(4);
    expect(out.layers[1]!.transform.x.keys.map((k) => k.value)).toEqual([1, 2]);
  });
  it("rejects an id that is taken; rename ignores blanks", () => {
    const c: Composition = { width: 100, height: 100, fps: 30, duration: 1, layers: [layer("a"), layer("b")] };
    expect(() => duplicateLayer("a", "b").apply(c)).toThrow();
    expect(renameLayer("a", "  ").apply(c)).toBe(c);
    expect(renameLayer("a", " Hero ").apply(c).layers[0]!.name).toBe("Hero");
  });
});

describe("composition settings", () => {
  it("changes size and fps, keeps layers", () => {
    const c = setCanvas({ width: 1080, height: 1920, fps: 60 }).apply({ ...empty, layers: [layer("a")] });
    expect([c.width, c.height, c.fps, c.layers.length]).toEqual([1080, 1920, 60, 1]);
  });
  it("rounds sizes and rejects out-of-range values", () => {
    expect(setCanvas({ width: 100.4 }).apply(empty).width).toBe(100);
    expect(() => setCanvas({ width: 5000 }).apply(empty)).toThrow();
    expect(() => setCanvas({ fps: 0 }).apply(empty)).toThrow();
  });
  it("is a no-op when nothing changes and sets the background", () => {
    expect(setCanvas({ width: 1920 }).apply(empty)).toBe(empty);
    expect(setBackground([0, 0, 0, 1]).apply(empty).background).toEqual([0, 0, 0, 1]);
  });
});

describe("moveLayerInTime", () => {
  const k = (t: number) => ({ id: `k${t}`, t, value: 1 });
  const l = (): Layer => ({ ...layer("a"), inPoint: 1, outPoint: 3, transform: { ...tf(), x: { keys: [k(1), k(2)] } } });
  const move = (dt: number, lay = l()) => moveLayerInTime("a", dt).apply({ ...empty, layers: [lay] }).layers[0]!;
  it("shifts range and keyframes together", () => {
    const m = move(2);
    expect([m.inPoint, m.outPoint]).toEqual([3, 5]);
    expect(m.transform.x.keys.map((q) => q.t)).toEqual([3, 4]);
  });
  it("clamps to the composition", () => {
    expect(move(-5).inPoint).toBe(0);
    expect(move(99).outPoint).toBe(10);
  });
  it("moves a video's start", () => {
    const v = { asset: "x", codedWidth: 1, codedHeight: 1, rotation: 0 as const, duration: 5, start: 1 };
    expect(move(1, { ...l(), video: v }).video?.start).toBe(2);
  });
});
