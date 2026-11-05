import { apply, invert, multiply, rotate, scale, translate, type Affine } from "../core/affine";
import type { Bounds } from "./hitTest";

/** Corner handles, clockwise from top-left, in layer-local bounds order. */
export type Corner = 0 | 1 | 2 | 3;

export function corners(b: Bounds): [number, number][] {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
}

/** Selection corners in composition space. */
export function worldCorners(b: Bounds, matrix: Affine): [number, number][] {
  return corners(b).map(([x, y]) => apply(matrix, x, y));
}

/** Corner opposite to `c`: the fixed point of a corner-drag scale. */
export const opposite = (c: Corner): Corner => ((c + 2) % 4) as Corner;

/**
 * Delta (composition space) that scales the layer about the opposite corner
 * while corner `c` follows the pointer. Left-multiply onto the layer's world
 * matrix: new = delta * old. `uniform` keeps the aspect ratio.
 * Returns null when the drag is degenerate (zero-size box or pivot hit).
 */
export function cornerScaleDelta(
  c: Corner,
  b: Bounds,
  matrix: Affine,
  pointer: readonly [number, number],
  uniform: boolean,
): Affine | null {
  const inv = invert(matrix);
  if (!inv) return null;
  const cs = corners(b);
  const [px, py] = cs[opposite(c)]!;
  const [hx, hy] = cs[c]!;
  const [lx, ly] = apply(inv, pointer[0], pointer[1]);
  const dx = hx - px;
  const dy = hy - py;
  let sx = dx === 0 ? 1 : (lx - px) / dx;
  let sy = dy === 0 ? 1 : (ly - py) / dy;
  if (uniform) {
    const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    sx = sy = s;
  }
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return null;
  // Scale in local space about the pivot, expressed in composition space:
  // M * S_local * M^-1.
  const local = multiply(translate(px, py), multiply(scale(sx, sy), translate(-px, -py)));
  return multiply(matrix, multiply(local, inv));
}

/** Delta rotating about `pivot` by the angle from `from` to `to` (composition space). */
export function rotateDelta(
  pivot: readonly [number, number],
  from: readonly [number, number],
  to: readonly [number, number],
  snapDegrees = 0,
): Affine {
  let a = Math.atan2(to[1] - pivot[1], to[0] - pivot[0]) - Math.atan2(from[1] - pivot[1], from[0] - pivot[0]);
  if (snapDegrees > 0) {
    const step = (snapDegrees * Math.PI) / 180;
    a = Math.round(a / step) * step;
  }
  return multiply(translate(pivot[0], pivot[1]), multiply(rotate(a), translate(-pivot[0], -pivot[1])));
}

export const moveDelta = (from: readonly [number, number], to: readonly [number, number]): Affine =>
  translate(to[0] - from[0], to[1] - from[1]);

/**
 * Which corner handle (if any) is within `radius` composition units of the
 * point. Radius should be (finger/pen radius in px) / zoom.
 */
export function hitCorner(b: Bounds, matrix: Affine, x: number, y: number, radius: number): Corner | null {
  let best: Corner | null = null;
  let bestD = radius;
  worldCorners(b, matrix).forEach(([cx, cy], i) => {
    const d = Math.hypot(cx - x, cy - y);
    if (d <= bestD) {
      bestD = d;
      best = i as Corner;
    }
  });
  return best;
}
