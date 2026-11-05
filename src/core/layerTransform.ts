import { multiply, rotate, scale, translate, type Affine, IDENTITY } from "./affine";
import { evalTrack } from "./evaluate";
import type { Id, Layer } from "./types";

/** Layer's matrix relative to its parent (or the composition) at time t. */
export function localMatrix(layer: Layer, t: number): Affine {
  const tr = layer.transform;
  const ax = evalTrack(tr.anchorX, t, 0);
  const ay = evalTrack(tr.anchorY, t, 0);
  const x = evalTrack(tr.x, t, 0);
  const y = evalTrack(tr.y, t, 0);
  const sx = evalTrack(tr.scaleX, t, 1);
  const sy = evalTrack(tr.scaleY, t, 1);
  const rot = (evalTrack(tr.rotation, t, 0) * Math.PI) / 180;
  return multiply(translate(x, y), multiply(rotate(rot), multiply(scale(sx, sy), translate(-ax, -ay))));
}

export function opacityAt(layer: Layer, t: number): number {
  return Math.min(1, Math.max(0, evalTrack(layer.transform.opacity, t, 1)));
}

/**
 * Matrix from the layer's local coordinates to composition coordinates,
 * following the parent chain. Throws on a parent cycle or a missing parent.
 */
export function worldMatrix(layers: readonly Layer[], id: Id, t: number): Affine {
  const byId = new Map(layers.map((l) => [l.id, l]));
  let m: Affine = IDENTITY;
  const seen = new Set<Id>();
  let cur: Layer | undefined = byId.get(id);
  if (!cur) throw new Error(`Unknown layer ${id}`);
  while (cur) {
    if (seen.has(cur.id)) throw new Error(`Parent cycle through layer ${cur.id}`);
    seen.add(cur.id);
    m = multiply(localMatrix(cur, t), m);
    if (cur.parent === undefined) break;
    const parent: Layer | undefined = byId.get(cur.parent);
    if (!parent) throw new Error(`Layer ${cur.id} has missing parent ${cur.parent}`);
    cur = parent;
  }
  return m;
}

/**
 * World matrices for every layer at time t in one pass (memoized), so cost is
 * linear in the layer count. Throws on a parent cycle or a missing parent.
 */
export function worldMatrices(layers: readonly Layer[], t: number): Map<Id, Affine> {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const out = new Map<Id, Affine>();
  const visiting = new Set<Id>();

  const resolve = (layer: Layer): Affine => {
    const known = out.get(layer.id);
    if (known) return known;
    if (visiting.has(layer.id)) throw new Error(`Parent cycle through layer ${layer.id}`);
    visiting.add(layer.id);
    let m = localMatrix(layer, t);
    if (layer.parent !== undefined) {
      const parent = byId.get(layer.parent);
      if (!parent) throw new Error(`Layer ${layer.id} has missing parent ${layer.parent}`);
      m = multiply(resolve(parent), m);
    }
    visiting.delete(layer.id);
    out.set(layer.id, m);
    return m;
  };

  for (const l of layers) resolve(l);
  return out;
}
