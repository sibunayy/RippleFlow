import type { Command } from "../core/history";
import type { Composition, Id, Keyframe, Layer, Track, Transform } from "../core/types";

/**
 * Which track of a layer a key lives on: a transform property ("x"), an effect value ("fx:<effectId>:<name>")
 * or a stroke trim end ("trim:start" / "trim:end").
 */
export type TrackPath = string;
export type KeyRef = { readonly layerId: Id; readonly prop: TrackPath; readonly keyId: Id };

/** Every keyframable track on a layer with its path. */
export function layerTrackPaths(layer: Layer): TrackPath[] {
  const out: TrackPath[] = Object.keys(layer.transform);
  for (const fx of layer.effects ?? []) for (const name of Object.keys(fx.values)) out.push(`fx:${fx.id}:${name}`);
  if (layer.shape?.trim) out.push("trim:start", "trim:end");
  return out;
}

export function trackAt(layer: Layer, path: TrackPath): Track | undefined {
  if (path.startsWith("fx:")) {
    const [, id, name] = path.split(":");
    return layer.effects?.find((e) => e.id === id)?.values[name!];
  }
  if (path.startsWith("trim:")) return layer.shape?.trim?.[path.slice(5) as "start" | "end"];
  return layer.transform[path as keyof Transform];
}

/** The layer with one track replaced. */
export function withTrack(layer: Layer, path: TrackPath, track: Track): Layer {
  if (path.startsWith("fx:")) {
    const [, id, name] = path.split(":");
    return { ...layer, effects: layer.effects?.map((e) => (e.id === id ? { ...e, values: { ...e.values, [name!]: track } } : e)) };
  }
  if (path.startsWith("trim:") && layer.shape?.trim) {
    return { ...layer, shape: { ...layer.shape, trim: { ...layer.shape.trim, [path.slice(5)]: track } } };
  }
  return { ...layer, transform: { ...layer.transform, [path]: track } };
}

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
  for (const prop of layerTrackPaths(layer)) {
    for (const k of trackAt(layer, prop)!.keys) {
      const col = cols.find((c) => Math.abs(c.t - k.t) < 1e-6);
      const ref = { layerId: layer.id, prop, keyId: k.id };
      if (col) col.refs.push(ref);
      else cols.push({ t: k.t, refs: [ref] });
    }
  }
  return cols.sort((a, b) => a.t - b.t);
}

/** True when the layer has any animation (a track with 2+ keys). */
export const isAnimated = (layer: Layer): boolean => layerTrackPaths(layer).some((p) => trackAt(layer, p)!.keys.length > 1);

function editTracks(comp: Composition, layerId: Id, fn: (prop: TrackPath, track: Track) => Track): Composition {
  const layer = comp.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Unknown layer ${layerId}`);
  let next = layer;
  for (const prop of layerTrackPaths(layer)) {
    const before = trackAt(next, prop)!;
    const after = fn(prop, before);
    if (after !== before) next = withTrack(next, prop, after);
  }
  return next === layer ? comp : { ...comp, layers: comp.layers.map((l) => (l.id === layerId ? next : l)) };
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
