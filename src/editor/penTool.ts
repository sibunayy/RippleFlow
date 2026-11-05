import type { NodePath, PathNode } from "../geometry/nodes";

/** Taps within this many screen pixels of the first point close the path. */
const CLOSE_RADIUS_PX = 20;
const DRAG_THRESHOLD_PX = 4;

export interface PenOutput {
  /** The path is finished (closed by tapping its first point). */
  readonly closed?: boolean;
}

/**
 * Drawing a path point by point: tap for a corner, drag to pull out a smooth
 * curve, tap the first point to close. Pure: coordinates are whatever space the
 * caller works in (composition or layer-local).
 */
export class PenTool {
  private nodes: PathNode[] = [];
  private active: { id: number; x0: number; y0: number; index: number; pulled: boolean } | null = null;

  get count(): number {
    return this.nodes.length;
  }

  get path(): NodePath {
    return { nodes: this.nodes, closed: false };
  }

  clear(): void {
    this.nodes = [];
    this.active = null;
  }

  /** Remove the last point (undo while drawing). */
  popPoint(): void {
    this.nodes = this.nodes.slice(0, -1);
    this.active = null;
  }

  down(id: number, x: number, y: number, unitsPerPx: number): PenOutput {
    if (this.active) return {};
    const first = this.nodes[0];
    if (first && this.nodes.length >= 3 && Math.hypot(first.x - x, first.y - y) <= CLOSE_RADIUS_PX * unitsPerPx) return { closed: true };
    this.nodes = [...this.nodes, { x, y, ix: 0, iy: 0, ox: 0, oy: 0 }];
    this.active = { id, x0: x, y0: y, index: this.nodes.length - 1, pulled: false };
    return {};
  }

  move(id: number, x: number, y: number, unitsPerPx: number): void {
    const a = this.active;
    if (!a || a.id !== id) return;
    if (!a.pulled && Math.hypot(x - a.x0, y - a.y0) < DRAG_THRESHOLD_PX * unitsPerPx) return;
    a.pulled = true;
    // Dragging pulls the outgoing handle toward the pointer; the incoming one mirrors it.
    const dx = x - a.x0;
    const dy = y - a.y0;
    this.nodes = this.nodes.map((n, i) => (i === a.index ? { ...n, ox: dx, oy: dy, ix: -dx, iy: -dy } : n));
  }

  up(id: number): void {
    if (this.active?.id === id) this.active = null;
  }
}
