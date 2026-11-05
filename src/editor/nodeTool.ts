import { apply, invert, maxScale, type Affine } from "../core/affine";
import { insertNode, moveHandle, moveNode, nearestOnPath, type NodePath } from "../geometry/nodes";

export interface NodeSel {
  readonly pi: number;
  readonly ni: number;
}

export interface NodeContext {
  readonly paths: readonly NodePath[];
  /** Layer-local to composition. */
  readonly matrix: Affine;
  /** Composition units per screen pixel. */
  readonly unitsPerPx: number;
}

export interface NodeOutput {
  /** Set when the selected node changed (null = cleared). */
  readonly select?: NodeSel | null;
  /** The whole edited path set. Previews and the final commit both carry the total change since the touch began. */
  readonly edit?: { readonly paths: NodePath[]; readonly final: boolean };
}

const NODE_RADIUS_PX = 22;
const SEGMENT_RADIUS_PX = 14;
const DRAG_THRESHOLD_PX = 3;

type Drag =
  | { kind: "node"; sel: NodeSel }
  | { kind: "handle"; sel: NodeSel; which: "in" | "out"; startX: number; startY: number }
  | { kind: "segment"; pi: number; seg: number; t: number }
  | { kind: "empty" };

/**
 * Point editing for one shape: tap a point to select it, drag points and
 * handles, tap the outline to add a point, tap empty space to deselect.
 * Pure: the controller feeds it pointer positions and applies its output.
 */
export class NodeTool {
  selection: NodeSel | null = null;
  private active: { id: number; drag: Drag; start: NodePath[]; x0: number; y0: number; lx0: number; ly0: number; moved: boolean } | null = null;

  setSelection(sel: NodeSel | null): void {
    this.selection = sel;
  }

  cancel(): void {
    this.active = null;
  }

  get dragging(): boolean {
    return this.active !== null;
  }

  down(id: number, x: number, y: number, ctx: NodeContext): NodeOutput {
    if (this.active) return {};
    const inv = invert(ctx.matrix);
    if (!inv) return {};
    const [lx, ly] = apply(inv, x, y);
    const near = (px: number, py: number, r: number) => Math.hypot(px - x, py - y) <= r * ctx.unitsPerPx;
    const start = ctx.paths as NodePath[];
    const R = NODE_RADIUS_PX;
    let drag: Drag = { kind: "empty" };
    let out: NodeOutput = {};

    const s = this.selection;
    const sn = s ? start[s.pi]?.nodes[s.ni] : undefined;
    if (s && sn) {
      for (const which of ["out", "in"] as const) {
        const hx = which === "in" ? sn.ix : sn.ox;
        const hy = which === "in" ? sn.iy : sn.oy;
        if (hx === 0 && hy === 0) continue;
        const [cx, cy] = apply(ctx.matrix, sn.x + hx, sn.y + hy);
        if (near(cx, cy, R)) {
          drag = { kind: "handle", sel: s, which, startX: hx, startY: hy };
          break;
        }
      }
    }
    if (drag.kind === "empty") {
      let best = Infinity;
      let picked: NodeSel | null = null;
      start.forEach((p, pi) =>
        p.nodes.forEach((n, ni) => {
          const [cx, cy] = apply(ctx.matrix, n.x, n.y);
          const d = Math.hypot(cx - x, cy - y);
          if (d <= R * ctx.unitsPerPx && d < best) {
            best = d;
            picked = { pi, ni };
          }
        }),
      );
      const sel = picked as NodeSel | null;
      if (sel) {
        drag = { kind: "node", sel };
        if (!s || s.pi !== sel.pi || s.ni !== sel.ni) {
          this.selection = sel;
          out = { select: sel };
        }
      }
    }
    if (drag.kind === "empty") {
      const hit = nearestOnPath(start, lx, ly);
      if (hit && hit.dist * maxScale(ctx.matrix) <= SEGMENT_RADIUS_PX * ctx.unitsPerPx) drag = { kind: "segment", pi: hit.pi, seg: hit.seg, t: hit.t };
    }
    this.active = { id, drag, start: [...start], x0: x, y0: y, lx0: lx, ly0: ly, moved: false };
    return out;
  }

  move(id: number, x: number, y: number, ctx: NodeContext): NodeOutput {
    const a = this.active;
    if (!a || a.id !== id) return {};
    if (!a.moved && Math.hypot(x - a.x0, y - a.y0) < DRAG_THRESHOLD_PX * ctx.unitsPerPx) return {};
    if (a.drag.kind !== "node" && a.drag.kind !== "handle") return {};
    a.moved = true;
    const inv = invert(ctx.matrix);
    if (!inv) return {};
    const [lx, ly] = apply(inv, x, y);
    const dx = lx - a.lx0;
    const dy = ly - a.ly0;
    const d = a.drag;
    const paths = d.kind === "node" ? moveNode(a.start, d.sel.pi, d.sel.ni, dx, dy) : moveHandle(a.start, d.sel.pi, d.sel.ni, d.which, d.startX + dx, d.startY + dy);
    return { edit: { paths, final: false } };
  }

  up(id: number, x: number, y: number, ctx: NodeContext): NodeOutput {
    const a = this.active;
    if (!a || a.id !== id) return {};
    const moved = this.move(id, x, y, ctx).edit;
    this.active = null;
    const d = a.drag;
    if (a.moved && (d.kind === "node" || d.kind === "handle")) {
      // Recompute the final state from the last position rather than trusting that the last move arrived.
      const inv = invert(ctx.matrix);
      if (!inv) return {};
      const [lx, ly] = apply(inv, x, y);
      const dx = lx - a.lx0;
      const dy = ly - a.ly0;
      const paths = d.kind === "node" ? moveNode(a.start, d.sel.pi, d.sel.ni, dx, dy) : moveHandle(a.start, d.sel.pi, d.sel.ni, d.which, d.startX + dx, d.startY + dy);
      void moved;
      return { edit: { paths, final: true } };
    }
    if (d.kind === "segment") {
      const n = a.start[d.pi]!.nodes.length;
      const sel = { pi: d.pi, ni: d.seg + 1 < n ? d.seg + 1 : n };
      this.selection = sel;
      return { select: sel, edit: { paths: insertNode(a.start, d.pi, d.seg, d.t), final: true } };
    }
    if (d.kind === "empty" && this.selection) {
      this.selection = null;
      return { select: null };
    }
    return {};
  }
}
