import { IDENTITY, multiply, scale, type Affine } from "../core/affine";
import type { Composition, Rgba } from "../core/types";
import type { SceneItem } from "../core/scene";
import type { ShapeGeometry } from "../geometry/layerGeometry";
import type { FrameRef } from "../video/videoLibrary";
import { rectMesh } from "../geometry/rect";
import type { Draw, GroupInfo, PlacedDraw } from "../render/meshRenderer";
import { scaleSpatial } from "../core/effects";
import type { EditorController } from "../editor/controller";
import { worldCorners } from "../editor/handles";

export const DEFAULT_BACKGROUND: Rgba = [1, 1, 1, 1];

/** The composition's backdrop as a draw (composition space through `toDevice`). */
export function backgroundDraw(comp: Composition, toDevice: Affine): PlacedDraw {
  return { mesh: rectMesh(comp.width, comp.height), color: comp.background ?? DEFAULT_BACKGROUND, transform: toDevice, opacity: 1 };
}

/** Layer draws for already-evaluated scene items, mapped to device pixels by `toDevice`. Empty meshes are dropped. */
export function drawsFor(
  items: readonly SceneItem[],
  geometryOf: (id: string) => ShapeGeometry | undefined,
  toDevice: Affine,
  /** Current frame of a video layer, if one has been decoded. Video layers with no frame yet are skipped. */
  mediaOf?: (id: string) => FrameRef | undefined,
): PlacedDraw[] {
  const out: PlacedDraw[] = [];
  const unit = Math.hypot(toDevice[0], toDevice[1]);
  items.forEach((item, itemIndex) => {
    const g = geometryOf(item.id);
    if (!g) return;
    const group: GroupInfo | undefined = item.effects.length
      ? { id: itemIndex, fx: item.effects.map((f) => scaleSpatial(f, unit)), opacity: item.opacity, blend: item.blend }
      : undefined;
    const first = out.length;
    const layerToDevice = multiply(toDevice, item.matrix);
    const [ma, mb, mc, md] = item.matrix;
    const sx = Math.hypot(ma, mb);
    const sy = Math.hypot(mc, md);
    for (const part of g.parts) {
      let mesh = part.mesh;
      let base = layerToDevice;
      // Non-uniform layer scale would thin a stroke along one axis; rebuild it in scaled space instead.
      if (part.strokeAt && sx > 1e-9 && sy > 1e-9 && Math.abs(sx - sy) > 1e-3 * Math.max(sx, sy)) {
        mesh = part.strokeAt(sx, sy);
        base = multiply(layerToDevice, [1 / sx, 0, 0, 1 / sy, 0, 0]);
      }
      if (mesh.indices.length === 0) continue;
      const transform = part.local ? multiply(base, part.local) : base;
      if (part.video) {
        const m = mediaOf?.(item.id);
        if (!m || (!m.frame && !m.image)) continue;
        out.push({ mesh, color: part.color, transform, opacity: item.opacity, blend: item.blend, ...(m.frame ? { frame: m.frame } : { image: m.image! }) });
      } else {
        out.push({ mesh, color: part.color, transform, opacity: item.opacity, blend: item.blend, ...(part.image ? { image: part.image } : {}), ...(part.gradient ? { gradient: part.gradient } : {}) });
      }
    }
    if (group) for (let i = first; i < out.length; i++) out[i] = { ...out[i]!, group };
  });
  return out;
}

/** Everything to draw for the editor view: backdrop, then layers, in canvas device pixels. */
export function buildDraws(ctrl: EditorController, devicePixelRatio: number): PlacedDraw[] {
  const toDevice = multiply(scale(devicePixelRatio), ctrl.view);
  const comp = ctrl.displayed;
  const videos = new Map(comp.layers.filter((l) => l.video).map((l) => [l.id, l.video!]));
  return [
    backgroundDraw(comp, toDevice),
    ...drawsFor(ctrl.scene(), (id) => ctrl.geometryOf(id), toDevice, (id) => {
      const v = videos.get(id);
      return v ? ctrl.frameOf(v, ctrl.time) : undefined;
    }),
  ];
}

interface Target {
  setScene(draws: readonly Draw[]): void;
  setTransform(index: number, m: Affine, opacity: number): void;
  setFrame(index: number, frame: VideoFrame | undefined): void;
  setGroup?(index: number, group: GroupInfo | undefined): void;
}

/**
 * Uploads geometry only when the set of meshes (or colors) changes; a moving
 * layer or a pan/zoom only rewrites the 64-byte uniforms.
 */
export class SceneSync {
  private last: PlacedDraw[] = [];

  sync(target: Target, draws: PlacedDraw[]): "scene" | "transforms" {
    const same =
      draws.length === this.last.length &&
      draws.every((d, i) => d.mesh === this.last[i]!.mesh && d.image === this.last[i]!.image && d.gradient === this.last[i]!.gradient && d.group?.id === this.last[i]!.group?.id && d.blend === this.last[i]!.blend && !d.frame === !this.last[i]!.frame && d.color.every((c, k) => c === this.last[i]!.color[k]));
    if (!same) {
      target.setScene(draws);
      this.last = draws;
      return "scene";
    }
    draws.forEach((d, i) => {
      if (d.frame) target.setFrame(i, d.frame); // a new video frame is a texture swap, not a geometry upload
      target.setTransform(i, d.transform, d.opacity);
      if (d.group) target.setGroup?.(i, d.group);
    });
    this.last = draws;
    return "transforms";
  }
}

/** Selected layer's box corners in canvas CSS pixels, clockwise from top-left, or null. */
export function selectionCorners(ctrl: EditorController): [number, number][] | null {
  const id = ctrl.selection;
  if (id === null) return null;
  const bounds = ctrl.geometryOf(id)?.bounds;
  const item = ctrl.scene().find((i) => i.id === id);
  if (!bounds || !item) return null;
  return worldCorners(bounds, multiply(ctrl.view, item.matrix));
}

