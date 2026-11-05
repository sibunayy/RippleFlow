import { multiply, rotate, scale, translate, type Affine } from "../core/affine";

/**
 * Turns two moving pointers into incremental pan + zoom + rotate transforms
 * (the usual canvas navigation gesture). Pure: feed it pointer positions, get
 * back the transform that maps the previous finger positions to the new ones.
 *
 * Only the first two pointers are tracked. If one lifts, the baseline resets
 * when a second pointer is down again, so there is no jump.
 */
export class TwoFingerGesture {
  private pts = new Map<number, { x: number; y: number }>();
  private order: number[] = [];

  /** True while exactly two pointers are being tracked. */
  get active(): boolean {
    return this.order.length === 2;
  }

  down(id: number, x: number, y: number): void {
    if (this.pts.has(id) || this.order.length >= 2) return;
    this.pts.set(id, { x, y });
    this.order.push(id);
  }

  up(id: number): void {
    this.pts.delete(id);
    this.order = this.order.filter((i) => i !== id);
  }

  /**
   * Update a pointer. Returns the delta transform (previous finger positions to
   * new ones) when two pointers are tracked, otherwise null. Apply it to
   * anything that should follow the fingers: `view = multiply(delta, view)`.
   */
  move(id: number, x: number, y: number): Affine | null {
    const p = this.pts.get(id);
    if (!p) return null;
    if (this.order.length !== 2) {
      p.x = x;
      p.y = y;
      return null;
    }
    const [aId, bId] = this.order as [number, number];
    const a0 = { ...this.pts.get(aId)! };
    const b0 = { ...this.pts.get(bId)! };
    p.x = x;
    p.y = y;
    const a1 = this.pts.get(aId)!;
    const b1 = this.pts.get(bId)!;

    const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
    if (d0 < 1e-6 || d1 < 1e-6) return null;
    const k = d1 / d0;
    const dTheta = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
    const c0x = (a0.x + b0.x) / 2;
    const c0y = (a0.y + b0.y) / 2;
    const c1x = (a1.x + b1.x) / 2;
    const c1y = (a1.y + b1.y) / 2;
    // Move the old centroid to the origin, scale and rotate, then move to the new centroid.
    return multiply(translate(c1x, c1y), multiply(rotate(dTheta), multiply(scale(k), translate(-c0x, -c0y))));
  }
}
