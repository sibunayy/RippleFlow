import { apply, invert } from "../core/affine";
import type { SceneItem } from "../core/scene";
import type { Id } from "../core/types";

/** Axis-aligned box in a layer's own coordinates. */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Topmost layer under the composition-space point (px, py), or null.
 * `items` is draw order (bottom first), so the search runs from the end.
 * `slop` is extra reach in composition units, so a Pencil tip can grab thin
 * shapes; callers should pass (touch/pen radius in screen px) / (view zoom).
 * Layers without bounds (not yet measured) are skipped.
 */
export function hitTest(
  items: readonly SceneItem[],
  boundsOf: (id: Id) => Bounds | undefined,
  px: number,
  py: number,
  slop = 0,
): Id | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    const b = boundsOf(item.id);
    if (!b) continue;
    const inv = invert(item.matrix);
    if (!inv) continue;
    const [lx, ly] = apply(inv, px, py);
    // Slop is in composition units; convert to local units with the matrix scale.
    const s = Math.hypot(inv[0], inv[1]);
    const r = slop * s;
    if (lx >= b.x - r && lx <= b.x + b.w + r && ly >= b.y - r && ly <= b.y + b.h + r) return item.id;
  }
  return null;
}
