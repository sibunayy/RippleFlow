import { describe, expect, it } from "vitest";
import { flatten } from "./path";
import { deleteNode, insertNode, isSmooth, moveHandle, moveNode, nearestOnPath, nodesToPath, parseNodes, setCorner, setSmooth } from "./nodes";
import { parseSvgPath } from "./svgPath";

const outline = (d: string) => flatten(parseSvgPath(d), 0.01).map((s) => s.points);
const close = (a: number[][], b: number[][], tol = 0.05) => {
  expect(a.length).toBe(b.length);
  a.forEach((p, i) => {
    expect(p.length).toBe(b[i]!.length);
    p.forEach((v, k) => expect(Math.abs(v - b[i]![k]!)).toBeLessThan(tol));
  });
};

describe("path to nodes and back", () => {
  it("a rectangle is 4 corner nodes", () => {
    const p = parseNodes("M0 0 H240 V240 H0 Z");
    expect(p).toHaveLength(1);
    expect(p[0]!.nodes).toHaveLength(4);
    expect(p[0]!.closed).toBe(true);
    expect(nodesToPath(p)).toBe("M0 0L240 0L240 240L0 240Z");
  });
  it("a path that returns to its start does not duplicate the node", () => {
    expect(parseNodes("M0 0 L10 0 L10 10 L0 0 Z")[0]!.nodes).toHaveLength(3);
  });
  it.each([
    ["ellipse", "M0 120 A120 120 0 1 0 240 120 A120 120 0 1 0 0 120 Z"],
    ["star", "M120 0 L152 86 L240 92 L172 148 L194 236 L120 188 L46 236 L68 148 L0 92 L88 86 Z"],
    ["quad", "M0 0 Q50 100 100 0 T200 0"],
    ["open cubic", "M0 0 C0 50 50 50 50 0"],
    ["two subpaths", "M0 0 L10 0 L10 10 Z M20 20 L30 20 L30 30 Z"],
  ])("keeps the drawn outline: %s", (_n, d) => close(outline(nodesToPath(parseNodes(d))), outline(d)));
  it("keeps the ellipse smooth at its nodes", () => {
    const e = parseNodes("M0 120 A120 120 0 1 0 240 120 A120 120 0 1 0 0 120 Z")[0]!;
    expect(e.nodes.every(isSmooth)).toBe(true);
  });
});

describe("editing", () => {
  const rect = () => parseNodes("M0 0 H100 V100 H0 Z");
  it("moves a node and keeps its handles relative", () => {
    const p = parseNodes("M0 0 C0 10 10 20 20 20");
    const m = moveNode(p, 0, 1, 5, 5)[0]!.nodes[1]!;
    expect([m.x, m.y, m.ix, m.iy]).toEqual([25, 25, -10, 0]);
  });
  it("dragging one handle of a smooth node swings the other, keeping its length", () => {
    const smooth = [{ nodes: [{ x: 0, y: 0, ix: -10, iy: 0, ox: 20, oy: 0 }, { x: 100, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }], closed: false }];
    const n = moveHandle(smooth, 0, 0, "out", 0, 5)[0]!.nodes[0]!;
    expect(n.ix).toBeCloseTo(0);
    expect(n.iy).toBeCloseTo(-10);
    expect([n.ox, n.oy]).toEqual([0, 5]);
  });
  it("a corner's handles move independently", () => {
    const c = [{ nodes: [{ x: 0, y: 0, ix: -10, iy: 0, ox: 10, oy: 10 }, { x: 5, y: 5, ix: 0, iy: 0, ox: 0, oy: 0 }], closed: false }];
    const n = moveHandle(c, 0, 0, "out", 0, 20)[0]!.nodes[0]!;
    expect([n.ix, n.iy]).toEqual([-10, 0]);
  });
  it("corner removes handles; smooth adds collinear ones", () => {
    const sm = setSmooth(rect(), 0, 1);
    expect(isSmooth(sm[0]!.nodes[1]!)).toBe(true);
    const back = setCorner(sm, 0, 1)[0]!.nodes[1]!;
    expect([back.ix, back.iy, back.ox, back.oy]).toEqual([0, 0, 0, 0]);
  });
  it("deletes a node; fewer than two nodes removes the path", () => {
    expect(deleteNode(rect(), 0, 2)[0]!.nodes).toHaveLength(3);
    expect(deleteNode(parseNodes("M0 0 L5 5"), 0, 0)).toHaveLength(0);
  });
  it("inserting a node does not change the curve", () => {
    const d = "M0 0 C0 100 100 100 100 0 L50 -50 Z";
    const before = parseNodes(d);
    for (let seg = 0; seg < 3; seg++) {
      const after = insertNode(before, 0, seg, 0.37);
      expect(after[0]!.nodes).toHaveLength(before[0]!.nodes.length + 1);
      const a = outline(nodesToPath(after));
      const b = outline(d);
      // Same shape: every sampled point of the new outline lies on the old one.
      const old = parseNodes(d);
      for (const pt of a[0]!.length ? [a[0]!] : []) for (let i = 0; i < pt.length; i += 2) expect(nearestOnPath(old, pt[i]!, pt[i + 1]!)!.dist).toBeLessThan(0.1);
      void b;
    }
  });
  it("inserting on the closing segment puts the node at the end", () => {
    const r = insertNode(rect(), 0, 3, 0.5);
    expect(r[0]!.nodes).toHaveLength(5);
    expect([r[0]!.nodes[4]!.x, r[0]!.nodes[4]!.y]).toEqual([0, 50]);
  });
  it("finds the nearest point on the outline", () => {
    const h = nearestOnPath(rect(), 50, -7)!;
    expect(h.seg).toBe(0);
    expect(h.x).toBeCloseTo(50, 1);
    expect(h.dist).toBeCloseTo(7, 1);
  });
});
