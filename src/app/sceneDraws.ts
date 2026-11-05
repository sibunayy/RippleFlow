import { multiply, scale, type Affine } from "../core/affine";
import type { Draw } from "../render/meshRenderer";
import type { EditorController } from "../editor/controller";
import { worldCorners } from "../editor/handles";

/** Draws for the current frame, in canvas device pixels. Empty meshes are dropped. */
export function buildDraws(ctrl: EditorController, devicePixelRatio: number): Required<Draw>[] {
  const toDevice = multiply(scale(devicePixelRatio), ctrl.view);
  const out: Required<Draw>[] = [];
  for (const item of ctrl.scene()) {
    const g = ctrl.geometryOf(item.id);
    if (!g) continue;
    const transform = multiply(toDevice, item.matrix);
    for (const part of g.parts) {
      if (part.mesh.indices.length === 0) continue;
      out.push({ mesh: part.mesh, color: part.color, transform, opacity: item.opacity });
    }
  }
  return out;
}

interface Target {
  setScene(draws: readonly Draw[]): void;
  setTransform(index: number, m: Affine, opacity: number): void;
}

/**
 * Uploads geometry only when the set of meshes (or colors) changes; a moving
 * layer or a pan/zoom only rewrites the 64-byte uniforms.
 */
export class SceneSync {
  private last: Required<Draw>[] = [];

  sync(target: Target, draws: Required<Draw>[]): "scene" | "transforms" {
    const same =
      draws.length === this.last.length &&
      draws.every((d, i) => d.mesh === this.last[i]!.mesh && d.color.every((c, k) => c === this.last[i]!.color[k]));
    if (!same) {
      target.setScene(draws);
      this.last = draws;
      return "scene";
    }
    draws.forEach((d, i) => target.setTransform(i, d.transform, d.opacity));
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

