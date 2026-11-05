import { IDENTITY, multiply, scale, type Affine } from "../core/affine";
import type { Composition, Mask, Rgba } from "../core/types";
import type { Mesh } from "../geometry/mesh";
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

/** The draws for one layer's own picture (no group, effects or matte). */
function layerDraws(item: SceneItem, g: ShapeGeometry, toDevice: Affine, mediaOf?: (id: string) => FrameRef | undefined): PlacedDraw[] {
  const out: PlacedDraw[] = [];
  const layerToDevice = multiply(toDevice, item.matrix);
  const [ma, mb, mc, md] = item.matrix;
  const sx = Math.hypot(ma, mb);
  const sy = Math.hypot(mc, md);
  for (const part of g.parts) {
    let mesh = part.mesh;
    let base = layerToDevice;
    let alpha = item.opacity;
    // Animated text: this part's character/word/line is displaced about its own pivot.
    const us = part.unit !== undefined ? item.units?.[part.unit] : undefined;
    if (us && part.pivot) {
      const [px, py] = part.pivot;
      const c = Math.cos(us.rotation) * us.scale;
      const s = Math.sin(us.rotation) * us.scale;
      const move: Affine = [c, s, -s, c, px + us.dx - c * px + s * py, py + us.dy - s * px - c * py];
      base = multiply(base, move);
      alpha *= us.opacity;
    }
    // Non-uniform layer scale would thin a stroke along one axis; rebuild it in scaled space instead.
    if (part.strokeAt && sx > 1e-9 && sy > 1e-9 && Math.abs(sx - sy) > 1e-3 * Math.max(sx, sy)) {
      mesh = part.strokeAt(sx, sy);
      base = multiply(base, [1 / sx, 0, 0, 1 / sy, 0, 0]);
    }
    if (mesh.indices.length === 0) continue;
    const transform = part.local ? multiply(base, part.local) : base;
    if (part.video) {
      const m = mediaOf?.(item.id);
      if (!m || (!m.frame && !m.image)) continue;
      out.push({ mesh, color: part.color, transform, opacity: alpha, blend: item.blend, ...(m.frame ? { frame: m.frame } : { image: m.image! }) });
    } else {
      out.push({ mesh, color: part.color, transform, opacity: alpha, blend: item.blend, ...(part.image ? { image: part.image } : {}), ...(part.gradient ? { gradient: part.gradient } : {}) });
    }
  }
  return out;
}

const WHITE: Rgba = [1, 1, 1, 1];

/**
 * Layer draws for already-evaluated scene items, mapped to device pixels by `toDevice`. Empty meshes are
 * dropped. A layer with effects, masks or a track matte becomes a group: its own draws, then one set of
 * draws per mask and the matte layer's draws, all tagged so the renderer can build and combine them.
 */
export function drawsFor(
  items: readonly SceneItem[],
  geometryOf: (id: string) => ShapeGeometry | undefined,
  toDevice: Affine,
  /** Current frame of a video layer, if one has been decoded. Video layers with no frame yet are skipped. */
  mediaOf?: (id: string) => FrameRef | undefined,
  /** Triangles for a mask's path (layer-local coordinates). */
  maskMeshOf?: (mask: Mask) => Mesh | undefined,
): PlacedDraw[] {
  const out: PlacedDraw[] = [];
  const unit = Math.hypot(toDevice[0], toDevice[1]);
  items.forEach((item, itemIndex) => {
    const g = geometryOf(item.id);
    if (!g) return;
    const own = layerDraws(item, g, toDevice, mediaOf);
    const grouped = item.effects.length > 0 || item.masks.length > 0 || !!item.matte;
    if (!grouped) {
      out.push(...own);
      return;
    }
    const group: GroupInfo = {
      id: itemIndex,
      fx: item.effects.map((f) => scaleSpatial(f, unit)),
      opacity: item.opacity,
      blend: item.blend,
      ...(item.masks.length ? { masks: item.masks.map((m) => ({ mode: m.mode, feather: m.feather * unit, opacity: m.opacity, inverted: !!m.inverted })) } : {}),
      ...(item.matte ? { matte: { mode: item.matte.mode } } : {}),
    };
    out.push(...own.map((d) => ({ ...d, group })));
    const layerToDevice = multiply(toDevice, item.matrix);
    item.masks.forEach((m, mi) => {
      const mesh = maskMeshOf?.(m);
      if (mesh && mesh.indices.length > 0) out.push({ mesh, color: WHITE, transform: layerToDevice, opacity: 1, group, role: { mask: mi } });
    });
    const src = item.matte?.source;
    const sg = src ? geometryOf(src.id) : undefined;
    if (src && sg) out.push(...layerDraws(src, sg, toDevice, mediaOf).map((d) => ({ ...d, group, role: "matte" as const })));
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
    ...drawsFor(
      ctrl.scene(),
      (id) => ctrl.geometryOf(id),
      toDevice,
      (id) => {
        const v = videos.get(id);
        return v ? ctrl.frameOf(v, ctrl.time) : undefined;
      },
      (m) => ctrl.maskMesh(m),
    ),
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
      draws.every((d, i) => d.mesh === this.last[i]!.mesh && d.image === this.last[i]!.image && d.gradient === this.last[i]!.gradient && d.group?.id === this.last[i]!.group?.id && JSON.stringify(d.role) === JSON.stringify(this.last[i]!.role) && d.blend === this.last[i]!.blend && !d.frame === !this.last[i]!.frame && d.color.every((c, k) => c === this.last[i]!.color[k]));
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

