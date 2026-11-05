import { editLayer } from "./commands";
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
export function applyPreset(layerId: Id, presetId: string, compDuration: number): Command {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Unknown preset ${presetId}`);
  return editLayer(layerId, preset.label, (layer: Layer) => {
    const a = layer.inPoint ?? 0;
    const b = layer.outPoint ?? compDuration;
    const dur = Math.min(preset.dur, Math.max(0, b - a));
    if (dur <= 0) return layer;
    const [ta, tb] = preset.kind === "in" ? [a, a + dur] : [b - dur, b];
    let transform = layer.transform;
    for (const [prop, stops] of Object.entries(preset.props) as [Prop, readonly Stop[]][]) {
      transform = { ...transform, [prop]: writeSpan(transform[prop], prop, stops, preset.kind, ta, tb, layerId) };
    }
    return { ...layer, transform };
  });
}
