import { editLayer, sequence } from "./commands";
import type { Command } from "./history";
import { evalTrack } from "./evaluate";
import type { Bezier, Id, Keyframe, Layer, Track, Transform } from "./types";

type Prop = keyof Transform;

interface Stop {
  /** 0..1 through the preset's span. */
  at: number;
  /** Value given the property's settled value (end value for "in", start value for "out"). */
  value: (base: number) => number;
  ease?: Bezier;
}

export interface Preset {
  readonly id: string;
  readonly label: string;
  /** "in" ends at the layer's in-point plus `dur`; "out" finishes at the layer's out-point. */
  readonly kind: "in" | "out";
  readonly dur: number;
  readonly props: Partial<Record<Prop, readonly Stop[]>>;
}

const OUT: Bezier = [0.2, 0.8, 0.2, 1];
const IN: Bezier = [0.5, 0, 0.8, 0.3];
const const0 = () => 0;
const same = (b: number) => b;

export const PRESETS: readonly Preset[] = [
  { id: "fade-in", label: "Fade in", kind: "in", dur: 0.5, props: { opacity: [{ at: 0, value: const0, ease: OUT }, { at: 1, value: same }] } },
  {
    id: "pop-in", label: "Pop in", kind: "in", dur: 0.5,
    props: {
      scaleX: [{ at: 0, value: const0, ease: OUT }, { at: 0.65, value: (b) => b * 1.12, ease: OUT }, { at: 1, value: same }],
      scaleY: [{ at: 0, value: const0, ease: OUT }, { at: 0.65, value: (b) => b * 1.12, ease: OUT }, { at: 1, value: same }],
      opacity: [{ at: 0, value: const0 }, { at: 0.2, value: same }],
    },
  },
  {
    id: "slide-up", label: "Slide up", kind: "in", dur: 0.6,
    props: { y: [{ at: 0, value: (b) => b + 160, ease: OUT }, { at: 1, value: same }], opacity: [{ at: 0, value: const0 }, { at: 0.5, value: same }] },
  },
  {
    id: "slide-right", label: "Slide in", kind: "in", dur: 0.6,
    props: { x: [{ at: 0, value: (b) => b - 260, ease: OUT }, { at: 1, value: same }], opacity: [{ at: 0, value: const0 }, { at: 0.5, value: same }] },
  },
  {
    id: "spin-in", label: "Spin in", kind: "in", dur: 0.8,
    props: {
      rotation: [{ at: 0, value: (b) => b - 180, ease: OUT }, { at: 1, value: same }],
      scaleX: [{ at: 0, value: const0, ease: OUT }, { at: 1, value: same }],
      scaleY: [{ at: 0, value: const0, ease: OUT }, { at: 1, value: same }],
    },
  },
  { id: "fade-out", label: "Fade out", kind: "out", dur: 0.5, props: { opacity: [{ at: 0, value: same, ease: IN }, { at: 1, value: const0 }] } },
  {
    id: "pop-out", label: "Pop out", kind: "out", dur: 0.4,
    props: {
      scaleX: [{ at: 0, value: same, ease: OUT }, { at: 0.3, value: (b) => b * 1.12, ease: IN }, { at: 1, value: const0 }],
      scaleY: [{ at: 0, value: same, ease: OUT }, { at: 0.3, value: (b) => b * 1.12, ease: IN }, { at: 1, value: const0 }],
    },
  },
  {
    id: "slide-down", label: "Slide down", kind: "out", dur: 0.6,
    props: { y: [{ at: 0, value: same, ease: IN }, { at: 1, value: (b) => b + 160 }], opacity: [{ at: 0.5, value: same }, { at: 1, value: const0 }] },
  },
  {
    id: "spin-out", label: "Spin out", kind: "out", dur: 0.8,
    props: {
      rotation: [{ at: 0, value: same, ease: IN }, { at: 1, value: (b) => b + 180 }],
      scaleX: [{ at: 0, value: same, ease: IN }, { at: 1, value: const0 }],
      scaleY: [{ at: 0, value: same, ease: IN }, { at: 1, value: const0 }],
    },
  },
];

const DEFAULTS: Record<Prop, number> = { anchorX: 0, anchorY: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
const EPS = 1e-6;

/** Replace the keys of `track` inside [ta, tb] with the preset's, leaving keys outside the span alone. */
function writeSpan(track: Track, prop: Prop, stops: readonly Stop[], kind: "in" | "out", ta: number, tb: number, layerId: Id): Track {
  const base = evalTrack(track, kind === "in" ? tb : ta, DEFAULTS[prop]);
  const added: Keyframe[] = stops.map((s) => {
    const t = ta + s.at * (tb - ta);
    return { id: `${layerId}.${prop}@pre-${t.toFixed(4)}`, t, value: s.value(base), ...(s.ease ? { ease: s.ease } : {}) };
  });
  const kept = track.keys.filter((k) => k.t < ta - EPS || k.t > tb + EPS);
  const keys = [...kept, ...added].sort((p, q) => p.t - q.t);
  return { keys };
}

/**
 * Animate a layer in at its in-point or out at its out-point with a ready-made motion. Values are relative to
 * where the layer sits when settled, so they work on any position/size. Replaces the keys of the properties
 * it touches within the span; everything else is kept.
 */
export function applyPreset(layerId: Id, presetId: string, compDuration: number, delay = 0): Command {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Unknown preset ${presetId}`);
  return editLayer(layerId, preset.label, (layer: Layer) => {
    const a = layer.inPoint ?? 0;
    const b = layer.outPoint ?? compDuration;
    const dur = Math.min(preset.dur, Math.max(0, b - a));
    if (dur <= 0) return layer;
    // `delay` pushes an "in" later and pulls an "out" earlier (for staggered groups), without changing the layer's range.
    const d = Math.min(Math.max(0, delay), Math.max(0, b - a - dur));
    const [ta, tb] = preset.kind === "in" ? [a + d, a + d + dur] : [b - d - dur, b - d];
    let transform = layer.transform;
    for (const [prop, stops] of Object.entries(preset.props) as [Prop, readonly Stop[]][]) {
      transform = { ...transform, [prop]: writeSpan(transform[prop], prop, stops, preset.kind, ta, tb, layerId) };
    }
    return { ...layer, transform };
  });
}

/** Apply a preset to every direct child of `parentId`, each starting `stagger` seconds after the one before (in stack order). */
export function applyPresetToChildren(parentId: Id, presetId: string, compDuration: number, stagger: number): Command {
  return {
    label: "Animate children",
    apply(comp) {
      const kids = comp.layers.filter((l) => l.parent === parentId);
      return sequence("Animate children", kids.map((k, i) => applyPreset(k.id, presetId, compDuration, i * Math.max(0, stagger)))).apply(comp);
    },
  };
}

/** The keys a preset wrote, on one track, in the half of the layer's range that `kind` uses. */
function presetKeys(track: Track, kind: "in" | "out", a: number, b: number): Keyframe[] {
  const mid = (a + b) / 2;
  return track.keys.filter((k) => k.id.includes("@pre-") && (kind === "in" ? k.t <= mid + EPS : k.t >= mid - EPS));
}

const TOUCHED = (kind: "in" | "out"): Prop[] => [...new Set(PRESETS.filter((p) => p.kind === kind).flatMap((p) => Object.keys(p.props) as Prop[]))];

/**
 * Which ready-made motion a layer currently carries at its in-point ("in") or out-point ("out"), or null.
 * Recognised from the keys `applyPreset` wrote: their tracks, count and relative timing.
 */
export function detectPreset(layer: Layer, kind: "in" | "out", compDuration: number): string | null {
  const a = layer.inPoint ?? 0;
  const b = layer.outPoint ?? compDuration;
  for (const p of PRESETS) {
    if (p.kind !== kind) continue;
    const dur = Math.min(p.dur, Math.max(0, b - a));
    if (dur <= 0) continue;
    let ok = true;
    let start: number | null = null;
    for (const prop of TOUCHED(kind)) {
      const keys = presetKeys(layer.transform[prop], kind, a, b);
      const stops = p.props[prop];
      if (!stops) {
        if (keys.length) ok = false;
        continue;
      }
      if (keys.length !== stops.length) { ok = false; break; }
      // Stops are relative to the preset's span: line them up with the first stop of the first track seen.
      const t0 = keys[0]!.t - stops[0]!.at * dur;
      if (start === null) start = t0;
      if (Math.abs(t0 - start) > 1e-3 || stops.some((s, i) => Math.abs(keys[i]!.t - (t0 + s.at * dur)) > 1e-3)) { ok = false; break; }
    }
    if (ok && start !== null) return p.id;
  }
  return null;
}

/** Remove the ready-made motion at a layer's in- or out-point, leaving the property at its settled value. */
export function clearPreset(layerId: Id, kind: "in" | "out", compDuration: number): Command {
  return editLayer(layerId, kind === "in" ? "Remove animate in" : "Remove animate out", (layer) => {
    const a = layer.inPoint ?? 0;
    const b = layer.outPoint ?? compDuration;
    let transform = layer.transform;
    for (const prop of TOUCHED(kind)) {
      const track = transform[prop];
      const gone = new Set(presetKeys(track, kind, a, b));
      if (gone.size === 0) continue;
      const list = [...gone];
      // "in" settles on its last key, "out" starts from its first.
      const settled = (kind === "in" ? list[list.length - 1] : list[0])!.value;
      const keys = track.keys.filter((k) => !gone.has(k));
      transform = { ...transform, [prop]: { keys: keys.length ? keys : [{ id: `${layerId}.${prop}@0`, t: 0, value: settled }] } };
    }
    return transform === layer.transform ? layer : { ...layer, transform };
  });
}
