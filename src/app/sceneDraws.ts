import { IDENTITY, multiply, scale, type Affine } from "../core/affine";
import type { Composition, Rgba } from "../core/types";
import type { SceneItem } from "../core/scene";
import type { ShapeGeometry } from "../geometry/layerGeometry";
import type { FrameRef } from "../video/videoLibrary";
import { rectMesh } from "../geometry/rect";
import type { Draw, PlacedDraw } from "../render/meshRenderer";
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
  for (const item of items) {
    const g = geometryOf(item.id);
    if (!g) continue;
    const layerToDevice = multiply(toDevice, item.matrix);
    for (const part of g.parts) {
      if (part.mesh.indices.length === 0) continue;
      const transform = part.local ? multiply(layerToDevice, part.local) : layerToDevice;
      if (part.video) {
        const m = mediaOf?.(item.id);
        if (!m || (!m.frame && !m.image)) continue;
        out.push({ mesh: part.mesh, color: part.color, transform, opacity: item.opacity, ...(m.frame ? { frame: m.frame } : { image: m.image! }) });
      } else {
        out.push({ mesh: part.mesh, color: part.color, transform, opacity: item.opacity, ...(part.image ? { image: part.image } : {}) });
      }
    }
  }
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
      draws.every((d, i) => d.mesh === this.last[i]!.mesh && d.image === this.last[i]!.image && !d.frame === !this.last[i]!.frame && d.color.every((c, k) => c === this.last[i]!.color[k]));
    if (!same) {
      target.setScene(draws);
      this.last = draws;
      return "scene";
    }
    draws.forEach((d, i) => {
      if (d.frame) target.setFrame(i, d.frame); // a new video frame is a texture swap, not a geometry upload
      target.setTransform(i, d.transform, d.opacity);
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

