import { apply, type Affine } from "../core/affine";
import type { SceneItem } from "../core/scene";
import type { Id } from "../core/types";
import { cornerScaleDelta, hitCorner, moveDelta, rotateDelta, type Corner } from "./handles";
import { hitTest, type Bounds } from "./hitTest";

export interface ToolEvent {
  readonly pointerType: "pen" | "mouse" | "touch";
  /** Composition coordinates. */
  readonly x: number;
  readonly y: number;
  readonly shift?: boolean;
}

export interface ToolContext {
  readonly items: readonly SceneItem[];
  readonly boundsOf: (id: Id) => Bounds | undefined;
  /** Composition units per screen pixel (1 / zoom). */
  readonly unitsPerPx: number;
}

export interface ToolOutput {
  /** Set when the selection changed (null = cleared). */
  readonly select?: Id | null;
  /**
   * Total change since the drag began, in composition space. Apply it to the
   * layer's world matrix at drag start (left-multiply). Previews and the final
   * commit both carry the total, so a dropped event never accumulates error.
   */
  readonly drag?: { readonly id: Id; readonly delta: Affine; readonly kind: "move" | "scale" | "rotate"; readonly final: boolean };
}

/** Finger-sized targets, in screen px. A Pencil tip is smaller than a finger. */
const HANDLE_RADIUS_PX = 16;
const ROTATE_BAND_PX = 40;
const PICK_SLOP_PX = 6;
const DRAG_THRESHOLD_PX = 3;
const ROTATE_SNAP_DEG = 15;

type Mode =
  | { kind: "idle" }
  | { kind: "pending"; id: Id; x: number; y: number }
  | { kind: "move"; id: Id; x: number; y: number }
  | { kind: "scale"; id: Id; corner: Corner }
  | { kind: "rotate"; id: Id; pivot: [number, number]; x: number; y: number };

/**
 * Select / move / scale / rotate. Pen and mouse only: touch is left to
 * navigation (pan/zoom), so a resting palm or finger never edits anything.
 * Pure state machine: no DOM, no document access.
 */
export class SelectTool {
  private mode: Mode = { kind: "idle" };
  private selected: Id | null = null;
  private pointerId: number | null = null;

  get selection(): Id | null {
    return this.selected;
  }

  setSelection(id: Id | null): void {
    this.selected = id;
  }

  get dragging(): boolean {
    return this.mode.kind !== "idle";
  }

  down(pointerId: number, e: ToolEvent, ctx: ToolContext): ToolOutput {
    if (e.pointerType === "touch" || this.pointerId !== null) return {};
    const r = ctx.unitsPerPx;
    const sel = this.selected;
    const item = sel ? ctx.items.find((i) => i.id === sel) : undefined;
    const b = sel ? ctx.boundsOf(sel) : undefined;

    if (item && b && sel) {
      const corner = hitCorner(b, item.matrix, e.x, e.y, HANDLE_RADIUS_PX * r);
      if (corner !== null) {
        this.pointerId = pointerId;
        this.mode = { kind: "scale", id: sel, corner };
        return {};
      }
      // Rotate: just outside a corner, and not on the shape itself.
      const near = hitCorner(b, item.matrix, e.x, e.y, ROTATE_BAND_PX * r);
      if (near !== null && hitTest([item], ctx.boundsOf, e.x, e.y, 0) === null) {
        const pivot = centre(b, item.matrix);
        this.pointerId = pointerId;
        this.mode = { kind: "rotate", id: sel, pivot, x: e.x, y: e.y };
        return {};
      }
    }

    const hit = hitTest(ctx.items, ctx.boundsOf, e.x, e.y, PICK_SLOP_PX * r);
    this.pointerId = pointerId;
    if (hit === null) {
      this.mode = { kind: "idle" };
      this.pointerId = null;
      if (this.selected === null) return {};
      this.selected = null;
      return { select: null };
    }
    const changed = hit !== this.selected;
    this.selected = hit;
    this.mode = { kind: "pending", id: hit, x: e.x, y: e.y };
    return changed ? { select: hit } : {};
  }

  move(pointerId: number, e: ToolEvent, ctx: ToolContext): ToolOutput {
    if (pointerId !== this.pointerId) return {};
    let m = this.mode;
    if (m.kind === "pending") {
      if (Math.hypot(e.x - m.x, e.y - m.y) < DRAG_THRESHOLD_PX * ctx.unitsPerPx) return {};
      m = this.mode = { kind: "move", id: m.id, x: m.x, y: m.y };
    }
    return this.dragOutput(m, e, ctx, false);
  }

  up(pointerId: number, e: ToolEvent, ctx: ToolContext): ToolOutput {
    if (pointerId !== this.pointerId) return {};
    const m = this.mode;
    const out = m.kind === "idle" || m.kind === "pending" ? {} : this.dragOutput(m, e, ctx, true);
    this.cancel();
    return out;
  }

  /** Abort the drag (pointercancel, or a second finger turned it into a gesture). */
  cancel(): void {
    this.mode = { kind: "idle" };
    this.pointerId = null;
  }

  private dragOutput(m: Mode, e: ToolEvent, ctx: ToolContext, final: boolean): ToolOutput {
    const p: [number, number] = [e.x, e.y];
    if (m.kind === "move") {
      let delta = moveDelta([m.x, m.y], p);
      if (e.shift) delta = axisLock(m, e);
      return { drag: { id: m.id, delta, kind: "move", final } };
    }
    if (m.kind === "rotate") {
      return { drag: { id: m.id, delta: rotateDelta(m.pivot, [m.x, m.y], p, e.shift ? ROTATE_SNAP_DEG : 0), kind: "rotate", final } };
    }
    if (m.kind === "scale") {
      const item = ctx.items.find((i) => i.id === m.id);
      const b = ctx.boundsOf(m.id);
      if (!item || !b) return {};
      const delta = cornerScaleDelta(m.corner, b, item.matrix, p, e.shift ?? false);
      return delta ? { drag: { id: m.id, delta, kind: "scale", final } } : {};
    }
    return {};
  }
}

function axisLock(m: { x: number; y: number }, e: ToolEvent): Affine {
  const dx = e.x - m.x;
  const dy = e.y - m.y;
  return Math.abs(dx) >= Math.abs(dy) ? [1, 0, 0, 1, dx, 0] : [1, 0, 0, 1, 0, dy];
}

function centre(b: Bounds, matrix: Affine): [number, number] {
  return apply(matrix, b.x + b.w / 2, b.y + b.h / 2);
}

