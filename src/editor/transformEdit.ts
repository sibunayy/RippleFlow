import { apply, invert, multiply, type Affine } from "../core/affine";
import type { Command } from "../core/history";
import { evalTrack } from "../core/evaluate";
import { worldMatrices } from "../core/layerTransform";
import type { Composition, Id, Layer, Track, Transform } from "../core/types";

type Prop = "x" | "y" | "scaleX" | "scaleY" | "rotation";
const DEFAULTS: Record<Prop, number> = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
const EPS = 1e-6;

/**
 * Local transform values that reproduce matrix `m` for a layer with the given
 * anchor. Skew is dropped (the transform model has none). Rotation is chosen
 * as the equivalent of `prevRotation` nearest to the result, so dragging past
 * 180 degrees does not jump by 360.
 */
export function decompose(m: Affine, anchorX: number, anchorY: number, prevRotation: number): Record<Prop, number> | null {
  const [a, b, c, d] = m;
  const sx = Math.hypot(a, b);
  if (sx < 1e-12) return null;
  const sy = (a * d - b * c) / sx; // negative for a mirrored layer
  let rot = (Math.atan2(b, a) * 180) / Math.PI;
  rot += 360 * Math.round((prevRotation - rot) / 360);
  const [x, y] = apply(m, anchorX, anchorY);
  return { x, y, scaleX: sx, scaleY: sy, rotation: rot };
}

function writeTrack(track: Track, t: number, value: number, autoKey: boolean, id: string): Track {
  if (autoKey || track.keys.length > 1) {
    const prior = track.keys.find((k) => Math.abs(k.t - t) <= 1e-9);
    const keys = track.keys.filter((k) => k !== prior);
    keys.push({ id, t, value, ...(prior?.ease ? { ease: prior.ease } : {}) });
    keys.sort((p, q) => p.t - q.t);
    return { keys };
  }
  // Static property: one constant key.
  return { keys: [{ id: track.keys[0]?.id ?? id, t: 0, value }] };
}

/**
 * Apply a composition-space delta (as reported by the tools) to a layer at
 * time `t`: new world = delta * old world, converted back to the layer's own
 * parent space and written into its tracks. Only properties that actually
 * changed are written. Pure; returns the same composition if nothing changed.
 */
export function applyWorldDelta(comp: Composition, layerId: Id, delta: Affine, t: number, autoKey: boolean): Composition {
  const layer = comp.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Unknown layer ${layerId}`);
  const worlds = worldMatrices(comp.layers, t);
  const parentWorld = layer.parent !== undefined ? worlds.get(layer.parent)! : undefined;
  const oldWorld = worlds.get(layerId)!;
  const newWorld = multiply(delta, oldWorld);
  let newLocal = newWorld;
  if (parentWorld) {
    const inv = invert(parentWorld);
    if (!inv) return comp;
    newLocal = multiply(inv, newWorld);
  }
  const tr = layer.transform;
  const ax = evalTrack(tr.anchorX, t, 0);
  const ay = evalTrack(tr.anchorY, t, 0);
  const next = decompose(newLocal, ax, ay, evalTrack(tr.rotation, t, 0));
  if (!next) return comp;

  let transform: Transform = tr;
  for (const prop of Object.keys(DEFAULTS) as Prop[]) {
    const cur = evalTrack(tr[prop], t, DEFAULTS[prop]);
    if (Math.abs(cur - next[prop]) <= EPS) continue;
    transform = { ...transform, [prop]: writeTrack(tr[prop], t, next[prop], autoKey, `${layerId}.${prop}@${t}`) };
  }
  if (transform === tr) return comp;
  const updated: Layer = { ...layer, transform };
  return { ...comp, layers: comp.layers.map((l) => (l.id === layerId ? updated : l)) };
}

export type EditableProp = Prop | "opacity";
const PROP_DEFAULTS: Record<EditableProp, number> = { ...DEFAULTS, opacity: 1 };

/** Value of an editable property at time `t`. */
export const propValue = (layer: Layer, prop: EditableProp, t: number): number => evalTrack(layer.transform[prop], t, PROP_DEFAULTS[prop]);

/** Set one property to `value` at time `t` (keyframed when animated or auto-key is on). */
export function setPropValue(layerId: Id, prop: EditableProp, value: number, t: number, autoKey: boolean): Command {
  return {
    label: `Set ${prop}`,
    apply(comp) {
      const layer = comp.layers.find((l) => l.id === layerId);
      if (!layer) throw new Error(`Unknown layer ${layerId}`);
      const v = prop === "opacity" ? Math.min(1, Math.max(0, value)) : value;
      if (!Number.isFinite(v)) return comp;
      if (Math.abs(propValue(layer, prop, t) - v) <= EPS) return comp;
      const transform: Transform = { ...layer.transform, [prop]: writeTrack(layer.transform[prop], t, v, autoKey, `${layerId}.${prop}@${t}`) };
      return { ...comp, layers: comp.layers.map((l) => (l.id === layerId ? { ...layer, transform } : l)) };
    },
  };
}

export function transformLayer(layerId: Id, delta: Affine, t: number, autoKey: boolean, label = "Transform layer"): Command {
  return { label, apply: (comp) => applyWorldDelta(comp, layerId, delta, t, autoKey) };
}

