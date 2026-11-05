import type { Affine } from "./affine";
import { opacityAt, worldMatrices } from "./layerTransform";
import type { Composition, Id, Layer } from "./types";

/** One layer, resolved for a single instant: ready for a renderer. */
export interface SceneItem {
  readonly id: Id;
  readonly kind: Layer["kind"];
  /** Layer-local to composition coordinates, including all ancestors. */
  readonly matrix: Affine;
  /** 0..1, this layer only (not inherited). */
  readonly opacity: number;
}

/**
 * Evaluate the composition at time `t` (seconds). Returns the visible layers in
 * draw order: the first layer in `comp.layers` is the bottom, the last is the
 * top. A layer is visible for inPoint <= t < outPoint (defaults: 0 and the
 * composition duration). Hidden layers still take part in parent chains, so a
 * visible child of a hidden parent keeps following it.
 *
 * Pure: the same composition and time always give the same result. Preview and
 * export both call this, so they cannot drift apart.
 */
export function evaluateScene(comp: Composition, t: number): SceneItem[] {
  const matrices = worldMatrices(comp.layers, t);
  const items: SceneItem[] = [];
  for (const layer of comp.layers) {
    const start = layer.inPoint ?? 0;
    const end = layer.outPoint ?? comp.duration;
    if (t < start || t >= end) continue;
    items.push({ id: layer.id, kind: layer.kind, matrix: matrices.get(layer.id)!, opacity: opacityAt(layer, t) });
  }
  return items;
}
