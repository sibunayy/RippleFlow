import { MeshBuilder, type Mesh } from "./mesh";
import type { Subpath } from "./path";

export type LineJoin = "miter" | "round" | "bevel";
export type LineCap = "butt" | "round" | "square";

export interface StrokeStyle {
  width: number;
  join?: LineJoin;
  cap?: LineCap;
  miterLimit?: number;
  /** Max deviation for round joins/caps, in path units. */
  tolerance?: number;
}

/**
 * Build triangles for a stroked polyline. Each segment is a quad; joins add a
 * wedge on the outer side of the turn; caps are added at open ends.
 *
 * Limitation (spike): overlapping pieces are not merged, so semi-transparent
 * strokes would show double-blending at joins. Render strokes opaque, or into
 * an offscreen layer and apply opacity there.
 */
export function tessellateStroke(subpaths: readonly Subpath[], style: StrokeStyle): Mesh {
  const hw = style.width / 2;
  const join = style.join ?? "miter";
  const cap = style.cap ?? "butt";
  const miterLimit = style.miterLimit ?? 4;
  const tol = style.tolerance ?? 0.1;
  const mb = new MeshBuilder();
  // Angular step so a round arc deviates by at most `tol`.
  const step = hw > tol ? 2 * Math.acos(1 - tol / hw) : Math.PI / 2;

  for (const sp of subpaths) {
    // Drop zero-length segments.
    const pts: number[] = [];
    for (let i = 0; i < sp.points.length; i += 2) {
      const x = sp.points[i]!;
      const y = sp.points[i + 1]!;
      const n = pts.length;
      if (n >= 2 && Math.hypot(x - pts[n - 2]!, y - pts[n - 1]!) < 1e-9) continue;
      pts.push(x, y);
    }
    const closed = sp.closed && pts.length >= 6;
    const n = pts.length / 2;
    if (n < 2) continue;

    const segCount = closed ? n : n - 1;
    const dirs: number[] = []; // unit directions per segment
    for (let s = 0; s < segCount; s++) {
      const a = s * 2;
      const b = ((s + 1) % n) * 2;
      const dx = pts[b]! - pts[a]!;
      const dy = pts[b + 1]! - pts[a + 1]!;
      const len = Math.hypot(dx, dy);
      dirs.push(dx / len, dy / len);
    }

    // Segment quads (with square caps extending the end quads).
    for (let s = 0; s < segCount; s++) {
      const a = s * 2;
      const b = ((s + 1) % n) * 2;
      const dx = dirs[s * 2]!;
      const dy = dirs[s * 2 + 1]!;
      let ax = pts[a]!;
      let ay = pts[a + 1]!;
      let bx = pts[b]!;
      let by = pts[b + 1]!;
      if (!closed && cap === "square") {
        if (s === 0) {
          ax -= dx * hw;
          ay -= dy * hw;
        }
        if (s === segCount - 1) {
          bx += dx * hw;
          by += dy * hw;
        }
      }
      const nx = -dy * hw;
      const ny = dx * hw;
      const v0 = mb.vertex(ax + nx, ay + ny);
      const v1 = mb.vertex(ax - nx, ay - ny);
      const v2 = mb.vertex(bx - nx, by - ny);
      const v3 = mb.vertex(bx + nx, by + ny);
      mb.tri(v0, v1, v2);
      mb.tri(v0, v2, v3);
    }

    // Joins at interior vertices (and at the seam of closed paths).
    for (let v = closed ? 0 : 1; v < (closed ? n : n - 1); v++) {
      const prev = closed ? (v + segCount - 1) % segCount : v - 1;
      const next = v % segCount;
      const d0x = dirs[prev * 2]!;
      const d0y = dirs[prev * 2 + 1]!;
      const d1x = dirs[next * 2]!;
      const d1y = dirs[next * 2 + 1]!;
      const cross = d0x * d1y - d0y * d1x;
      const dot = d0x * d1x + d0y * d1y;
      if (Math.abs(cross) < 1e-9 && dot > 0) continue; // straight through
      const px = pts[v * 2]!;
      const py = pts[v * 2 + 1]!;
      // Outer side is opposite the turn direction.
      const side = cross > 0 ? -1 : 1;
      const n0x = -d0y * side;
      const n0y = d0x * side;
      const n1x = -d1y * side;
      const n1y = d1x * side;
      const ax = px + n0x * hw;
      const ay = py + n0y * hw;
      const bx = px + n1x * hw;
      const by = py + n1y * hw;

      if (join === "round" || (Math.abs(cross) < 1e-9 && dot < 0)) {
        fan(mb, px, py, Math.atan2(n0y, n0x), Math.atan2(n1y, n1x), hw, step, cross, side, dot);
      } else {
        const ratio = 1 / Math.sqrt(Math.max(1e-12, (1 + (n0x * n1x + n0y * n1y)) / 2));
        if (join === "miter" && ratio <= miterLimit) {
          const k = hw / (1 + n0x * n1x + n0y * n1y);
          const tx = px + (n0x + n1x) * k;
          const ty = py + (n0y + n1y) * k;
          mb.triPoints(px, py, ax, ay, tx, ty);
          mb.triPoints(px, py, tx, ty, bx, by);
        } else {
          mb.triPoints(px, py, ax, ay, bx, by);
        }
      }
    }

    // Round caps at open ends (butt: nothing; square handled above).
    if (!closed && cap === "round") {
      const d0 = Math.atan2(dirs[1]!, dirs[0]!);
      const dEnd = Math.atan2(dirs[(segCount - 1) * 2 + 1]!, dirs[(segCount - 1) * 2]!);
      semicircle(mb, pts[0]!, pts[1]!, d0 + Math.PI / 2, hw, step);
      semicircle(mb, pts[(n - 1) * 2]!, pts[(n - 1) * 2 + 1]!, dEnd - Math.PI / 2, hw, step);
    }
  }
  return mb.build();
}

/** Fan of triangles around (cx, cy) covering the outer arc from angle a0 to a1. */
function fan(
  mb: MeshBuilder, cx: number, cy: number, a0: number, a1: number,
  r: number, step: number, cross: number, side: number, dot: number,
): void {
  let sweep = a1 - a0;
  // Pick the short way around, in the direction of the outer side.
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  if (Math.abs(cross) < 1e-9 && dot < 0) sweep = side * Math.PI; // 180° reversal
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  const c = mb.vertex(cx, cy);
  let prev = mb.vertex(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
  for (let i = 1; i <= count; i++) {
    const a = a0 + (sweep * i) / count;
    const cur = mb.vertex(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    mb.tri(c, prev, cur);
    prev = cur;
  }
}

function semicircle(mb: MeshBuilder, cx: number, cy: number, a0: number, r: number, step: number): void {
  const count = Math.max(2, Math.ceil(Math.PI / step));
  const c = mb.vertex(cx, cy);
  let prev = mb.vertex(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
  for (let i = 1; i <= count; i++) {
    const a = a0 + (Math.PI * i) / count;
    const cur = mb.vertex(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    mb.tri(c, prev, cur);
    prev = cur;
  }
}
