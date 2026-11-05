import type { Command } from "../core/history";
import type { Composition, Id, Keyframe, Layer, Track, Transform } from "../core/types";

export type KeyRef = { readonly layerId: Id; readonly prop: keyof Transform; readonly keyId: Id };

/** Time in seconds snapped to the nearest frame. */
export const snapToFrame = (t: number, fps: number): number => Math.round(t * fps) / fps;

/** One diamond on the timeline: all properties keyed at the same instant on a layer. */
export interface KeyColumn {
  readonly t: number;
  readonly refs: readonly KeyRef[];
}

/** Keyframe columns for a layer, sorted by time. Keys within 1e-6 s share a column. */
export function keyColumns(layer: Layer): KeyColumn[] {
  const cols: { t: number; refs: KeyRef[] }[] = [];
  for (const prop of Object.keys(layer.transform) as (keyof Transform)[]) {
    for (const k of layer.transform[prop].keys) {
      const col = cols.find((c) => Math.abs(c.t - k.t) < 1e-6);
      const ref = { layerId: layer.id, prop, keyId: k.id };
      if (col) col.refs.push(ref);
      else cols.push({ t: k.t, refs: [ref] });
    }
  }
  return cols.sort((a, b) => a.t - b.t);
}

/** True when the layer has any animation (a track with 2+ keys). */
export const isAnimated = (layer: Layer): boolean => Object.values(layer.transform).some((t: Track) => t.keys.length > 1);

function editTracks(comp: Composition, layerId: Id, fn: (prop: keyof Transform, track: Track) => Track): Composition {
  const layer = comp.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Unknown layer ${layerId}`);
  let transform: Transform = layer.transform;
  for (const prop of Object.keys(transform) as (keyof Transform)[]) {
    const before = transform[prop];
    const after = fn(prop, before);
    if (after !== before) transform = { ...transform, [prop]: after };
  }
  if (transform === layer.transform) return comp;
  return { ...comp, layers: comp.layers.map((l) => (l.id === layerId ? { ...layer, transform } : l)) };
}

/**
 * Shift the referenced keys by `dt` seconds (clamped to [0, duration]). A moved
 * key replaces any unmoved key it lands on. Keys stay sorted.
 */
export function moveKeys(refs: readonly KeyRef[], dt: number): Command {
  return {
    label: "Move keyframes",
    apply(comp) {
      if (dt === 0 || refs.length === 0) return comp;
      let out = comp;
      for (const layerId of new Set(refs.map((r) => r.layerId))) {
        const mine = new Set(refs.filter((r) => r.layerId === layerId).map((r) => `${r.prop}:${r.keyId}`));
        out = editTracks(out, layerId, (prop, track) => {
          if (!track.keys.some((k) => mine.has(`${prop}:${k.id}`))) return track;
          const moved: Keyframe[] = [];
          const still: Keyframe[] = [];
          for (const k of track.keys) (mine.has(`${prop}:${k.id}`) ? moved : still).push(k);
          const shifted = moved.map((k) => ({ ...k, t: Math.min(Math.max(k.t + dt, 0), comp.duration) }));
          const kept = still.filter((k) => !shifted.some((m) => Math.abs(m.t - k.t) < 1e-6));
          return { keys: [...kept, ...shifted].sort((a, b) => a.t - b.t) };
        });
      }
      return out;
    },
  };
}

export function deleteKeys(refs: readonly KeyRef[]): Command {
  return {
    label: "Delete keyframes",
    apply(comp) {
      let out = comp;
      for (const layerId of new Set(refs.map((r) => r.layerId))) {
        const mine = new Set(refs.filter((r) => r.layerId === layerId).map((r) => `${r.prop}:${r.keyId}`));
        out = editTracks(out, layerId, (prop, track) => {
          const keys = track.keys.filter((k) => !mine.has(`${prop}:${k.id}`));
          return keys.length === track.keys.length ? track : { keys };
        });
      }
      return out;
    },
  };
}
