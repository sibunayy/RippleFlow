import { apply, type Affine } from "../core/affine";
import { parseSvgPath } from "./svgPath";
import type { PathCmd } from "./path";

/**
 * Editable form of a path: anchor points with bezier handles. Handles are
 * offsets from their anchor, so moving an anchor moves its handles with it.
 * A zero handle means "straight". Pure: no DOM, no GPU.
 */
export interface PathNode {
  readonly x: number;
  readonly y: number;
  /** Handle towards the previous node. */
  readonly ix: number;
  readonly iy: number;
  /** Handle towards the next node. */
  readonly ox: number;
  readonly oy: number;
}

export interface NodePath {
  readonly nodes: readonly PathNode[];
  readonly closed: boolean;
}

const EPS = 1e-9;
const node = (x: number, y: number, ix = 0, iy = 0, ox = 0, oy = 0): PathNode => ({ x, y, ix, iy, ox, oy });

/** Convert parsed path commands. Quadratics become cubics (same curve). */
export function pathToNodes(cmds: readonly PathCmd[]): NodePath[] {
  const out: NodePath[] = [];
  let cur: PathNode[] | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const finish = (closed: boolean) => {
    if (cur && cur.length >= 2) {
      let nodes = cur;
      if (closed && nodes.length > 2) {
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        // The path came back to its start: that is one node, not two.
        if (Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS) {
          nodes = [{ ...first, ix: last.ix, iy: last.iy }, ...nodes.slice(1, -1)];
        }
      }
      out.push({ nodes, closed });
    }
    cur = null;
  };
  const setOut = (ox: number, oy: number) => {
    const n = cur!;
    const p = n[n.length - 1]!;
    n[n.length - 1] = { ...p, ox, oy };
  };
  for (const c of cmds) {
    switch (c.t) {
      case "M":
        finish(false);
        cur = [node(c.x, c.y)];
        cx = sx = c.x;
        cy = sy = c.y;
        break;
      case "L":
        if (!cur) cur = [node(cx, cy)];
        cur.push(node(c.x, c.y));
        cx = c.x;
        cy = c.y;
        break;
      case "Q": {
        if (!cur) cur = [node(cx, cy)];
        const c1x = cx + (2 / 3) * (c.x1 - cx);
        const c1y = cy + (2 / 3) * (c.y1 - cy);
        const c2x = c.x + (2 / 3) * (c.x1 - c.x);
        const c2y = c.y + (2 / 3) * (c.y1 - c.y);
        setOut(c1x - cx, c1y - cy);
        cur.push(node(c.x, c.y, c2x - c.x, c2y - c.y));
        cx = c.x;
        cy = c.y;
        break;
      }
      case "C":
        if (!cur) cur = [node(cx, cy)];
        setOut(c.x1 - cx, c.y1 - cy);
        cur.push(node(c.x, c.y, c.x2 - c.x, c.y2 - c.y));
        cx = c.x;
        cy = c.y;
        break;
      case "Z":
        finish(true);
        cx = sx;
        cy = sy;
        break;
    }
  }
  finish(false);
  return out;
}

export const parseNodes = (d: string): NodePath[] => pathToNodes(parseSvgPath(d));

const f = (v: number): string => String(Math.round(v * 1000) / 1000);
const straight = (a: PathNode, b: PathNode) => a.ox === 0 && a.oy === 0 && b.ix === 0 && b.iy === 0;

function segment(a: PathNode, b: PathNode): string {
  if (straight(a, b)) return `L${f(b.x)} ${f(b.y)}`;
  return `C${f(a.x + a.ox)} ${f(a.y + a.oy)} ${f(b.x + b.ix)} ${f(b.y + b.iy)} ${f(b.x)} ${f(b.y)}`;
}

export function nodesToPath(paths: readonly NodePath[]): string {
  return paths
    .map((p) => {
      const n = p.nodes;
      if (n.length === 0) return "";
      let d = `M${f(n[0]!.x)} ${f(n[0]!.y)}`;
      for (let i = 1; i < n.length; i++) d += segment(n[i - 1]!, n[i]!);
      if (p.closed) {
        if (!straight(n[n.length - 1]!, n[0]!)) d += segment(n[n.length - 1]!, n[0]!);
        d += "Z";
      }
      return d;
    })
    .join("");
}

const len = (x: number, y: number) => Math.hypot(x, y);

/** Handles are collinear and point opposite ways, so the curve passes through smoothly. */
export function isSmooth(n: PathNode): boolean {
  const li = len(n.ix, n.iy);
  const lo = len(n.ox, n.oy);
  if (li < 1e-6 || lo < 1e-6) return false;
  const cross = n.ix * n.oy - n.iy * n.ox;
  const dot = n.ix * n.ox + n.iy * n.oy;
  return Math.abs(cross) <= 1e-3 * li * lo && dot < 0;
}

type Paths = readonly NodePath[];

function withNode(paths: Paths, pi: number, ni: number, fn: (n: PathNode) => PathNode): NodePath[] {
  return paths.map((p, a) => (a !== pi ? p : { ...p, nodes: p.nodes.map((n, b) => (b === ni ? fn(n) : n)) }));
}

export function moveNode(paths: Paths, pi: number, ni: number, dx: number, dy: number): NodePath[] {
  return withNode(paths, pi, ni, (n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
}

/**
 * Set a handle (offset from its anchor). On a smooth node the opposite handle
 * turns to stay collinear and keeps its own length.
 */
export function moveHandle(paths: Paths, pi: number, ni: number, which: "in" | "out", hx: number, hy: number): NodePath[] {
  return withNode(paths, pi, ni, (n) => {
    const smooth = isSmooth(n);
    let next: PathNode = which === "in" ? { ...n, ix: hx, iy: hy } : { ...n, ox: hx, oy: hy };
    const l = len(hx, hy);
    if (smooth && l > 1e-9) {
      const ol = which === "in" ? len(n.ox, n.oy) : len(n.ix, n.iy);
      const ox = (-hx / l) * ol;
      const oy = (-hy / l) * ol;
      next = which === "in" ? { ...next, ox, oy } : { ...next, ix: ox, iy: oy };
    }
    return next;
  });
}

/** Retract both handles: a sharp corner between straight (or neighbouring-curve) segments. */
export function setCorner(paths: Paths, pi: number, ni: number): NodePath[] {
  return withNode(paths, pi, ni, (n) => ({ ...n, ix: 0, iy: 0, ox: 0, oy: 0 }));
}

/** Give the node collinear handles along the direction between its neighbours, a third of the way to each. */
export function setSmooth(paths: Paths, pi: number, ni: number): NodePath[] {
  const p = paths[pi];
  if (!p) return [...paths];
  const n = p.nodes;
  const count = n.length;
  const prev = ni > 0 ? n[ni - 1] : p.closed ? n[count - 1] : undefined;
  const next = ni < count - 1 ? n[ni + 1] : p.closed ? n[0] : undefined;
  const cur = n[ni]!;
  const a = prev ?? cur;
  const b = next ?? cur;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const dl = len(dx, dy);
  if (dl < EPS) return [...paths];
  dx /= dl;
  dy /= dl;
  const lin = prev ? len(cur.x - prev.x, cur.y - prev.y) / 3 : 0;
  const lout = next ? len(next.x - cur.x, next.y - cur.y) / 3 : 0;
  return withNode(paths, pi, ni, (c) => ({ ...c, ix: -dx * lin, iy: -dy * lin, ox: dx * lout, oy: dy * lout }));
}

export function deleteNode(paths: Paths, pi: number, ni: number): NodePath[] {
  const out: NodePath[] = [];
  paths.forEach((p, a) => {
    if (a !== pi) return void out.push(p);
    const nodes = p.nodes.filter((_, b) => b !== ni);
    if (nodes.length >= 2) out.push({ ...p, nodes });
  });
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Segment `seg` runs from node `seg` to the next node (wrapping when the path is closed). Shape is unchanged. */
export function insertNode(paths: Paths, pi: number, seg: number, t: number): NodePath[] {
  const p = paths[pi];
  if (!p) return [...paths];
  const n = p.nodes;
  const j = seg + 1 < n.length ? seg + 1 : p.closed ? 0 : -1;
  if (j < 0) return [...paths];
  const a = n[seg]!;
  const b = n[j]!;
  const p0 = [a.x, a.y], p1 = [a.x + a.ox, a.y + a.oy], p2 = [b.x + b.ix, b.y + b.iy], p3 = [b.x, b.y];
  const mix = (u: number[], v: number[]) => [lerp(u[0]!, v[0]!, t), lerp(u[1]!, v[1]!, t)];
  const p01 = mix(p0, p1), p12 = mix(p1, p2), p23 = mix(p2, p3);
  const p012 = mix(p01, p12), p123 = mix(p12, p23);
  const s = mix(p012, p123);
  const made = node(s[0]!, s[1]!, p012[0]! - s[0]!, p012[1]! - s[1]!, p123[0]! - s[0]!, p123[1]! - s[1]!);
  const nodes = n.map((x, i) => (i === seg ? { ...x, ox: p01[0]! - p0[0]!, oy: p01[1]! - p0[1]! } : i === j ? { ...x, ix: p23[0]! - p3[0]!, iy: p23[1]! - p3[1]! } : x));
  // Wrapping segment: the new node goes at the end of the list.
  nodes.splice(j === 0 ? nodes.length : seg + 1, 0, made);
  return paths.map((q, i) => (i === pi ? { ...q, nodes } : q));
}

export interface PathHit {
  readonly pi: number;
  /** Segment index (see insertNode). */
  readonly seg: number;
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly dist: number;
}

/** Closest point on any segment to (px, py), by sampling then refining. Null for an empty path. */
export function nearestOnPath(paths: Paths, px: number, py: number): PathHit | null {
  let best: PathHit | null = null;
  paths.forEach((p, pi) => {
    const n = p.nodes;
    const segs = p.closed ? n.length : n.length - 1;
    for (let s = 0; s < segs; s++) {
      const a = n[s]!;
      const b = n[(s + 1) % n.length]!;
      const at = (t: number): [number, number] => {
        const u = 1 - t;
        const x1 = a.x + a.ox, y1 = a.y + a.oy, x2 = b.x + b.ix, y2 = b.y + b.iy;
        return [
          u * u * u * a.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * b.x,
          u * u * u * a.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * b.y,
        ];
      };
      const d2 = (t: number) => {
        const [x, y] = at(t);
        return (x - px) ** 2 + (y - py) ** 2;
      };
      let bt = 0;
      let bd = Infinity;
      for (let i = 0; i <= 32; i++) {
        const d = d2(i / 32);
        if (d < bd) (bd = d), (bt = i / 32);
      }
      for (let step = 1 / 64; step > 1e-4; step /= 2) {
        for (const c of [bt - step, bt + step]) {
          const t = Math.min(1, Math.max(0, c));
          const d = d2(t);
          if (d < bd) (bd = d), (bt = t);
        }
      }
      const dist = Math.sqrt(bd);
      if (!best || dist < best.dist) {
        const [x, y] = at(bt);
        best = { pi, seg: s, t: bt, x, y, dist };
      }
    }
  });
  return best;
}

/** Map every point (and handle) through an affine transform. */
export function transformPath(p: NodePath, m: Affine): NodePath {
  const [a, b, c, d] = m;
  return {
    closed: p.closed,
    nodes: p.nodes.map((n) => {
      const [x, y] = apply(m, n.x, n.y);
      return { x, y, ix: a * n.ix + c * n.iy, iy: b * n.ix + d * n.iy, ox: a * n.ox + c * n.oy, oy: b * n.ox + d * n.oy };
    }),
  };
}

/** Box around all anchors and handle tips, or undefined when empty. */
export function pathBounds(paths: readonly NodePath[]): { x: number; y: number; w: number; h: number } | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths)
    for (const n of p.nodes)
      for (const [x, y] of [[n.x, n.y], [n.x + n.ix, n.y + n.iy], [n.x + n.ox, n.y + n.oy]] as const) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  return minX <= maxX ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : undefined;
}
