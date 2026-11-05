import type { Affine } from "./affine";
import { opacityAt, worldMatrices } from "./layerTransform";
import type { BlendMode, Composition, Id, Layer, Mask, MatteMode } from "./types";
import { textUnits, unitStates, type UnitState } from "./text";
import type { ResolvedPin } from "../geometry/warp";
import { evalTrack } from "./evaluate";
import { resolveEffects, type ResolvedFx } from "./effects";

/** One layer, resolved for a single instant: ready for a renderer. */
export interface SceneItem {
  readonly id: Id;
  readonly kind: Layer["kind"];
  /** Layer-local to composition coordinates, including all ancestors. */
  readonly matrix: Affine;
  /** 0..1, this layer only (not inherited). */
  readonly opacity: number;
  readonly blend: BlendMode;
  /** Enabled effects with values at this instant. Empty for most layers. */
  readonly effects: readonly ResolvedFx[];
  readonly masks: readonly Mask[];
  /** Text layers with an animator: how each character/word/line is displaced now. */
  readonly units?: readonly UnitState[];
  /** Image layers with puppet pins: where each pin is pulled to now. */
  readonly pins?: readonly ResolvedPin[];
  /** The matte layer evaluated at this instant. `source` is null when it is not visible now (an empty matte). */
  readonly matte?: { readonly mode: MatteMode; readonly source: SceneItem | null };
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
  const visible = (layer: Layer) => t >= (layer.inPoint ?? 0) && t < (layer.outPoint ?? comp.duration);
  const make = (layer: Layer, withMatte: boolean): SceneItem => {
    const item: SceneItem = {
      id: layer.id,
      kind: layer.kind,
      matrix: matrices.get(layer.id)!,
      opacity: opacityAt(layer, t),
      blend: layer.blend ?? "normal",
      effects: withMatte ? resolveEffects(layer, t) : [],
      masks: withMatte ? (layer.masks ?? []) : [],
      ...(layer.image?.pins?.length ? { pins: layer.image.pins.map((p) => ({ x: p.x, y: p.y, dx: evalTrack(p.dx, t, 0), dy: evalTrack(p.dy, t, 0) })) } : {}),
      ...(layer.text?.animator ? { units: unitStates(layer.text.animator, textUnits(layer.text.text, layer.text.animator.unit).length, t) } : {}),
    };
    if (!withMatte || !layer.matte) return item;
    const src = comp.layers.find((l) => l.id === layer.matte!.source);
    return { ...item, matte: { mode: layer.matte.mode, source: src && visible(src) ? make(src, false) : null } };
  };
  const items: SceneItem[] = [];
  for (const layer of comp.layers) {
    if (layer.hidden || !visible(layer)) continue;
    items.push(make(layer, true));
  }
  return items;
}
