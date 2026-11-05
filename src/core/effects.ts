import { evalTrack } from "./evaluate";
import type { Effect, EffectType, Layer, Rgba } from "./types";

export interface ParamSpec {
  readonly key: string;
  readonly label: string;
  readonly def: number;
  readonly min: number;
  readonly max: number;
  /** Display units per pixel dragged. */
  readonly perPx: number;
  /** Display value = stored * mul (e.g. 100 for percentages). */
  readonly mul?: number;
  /** In composition units: scaled by the view or export size so a blur looks the same at every size. */
  readonly spatial?: boolean;
}

export interface EffectSpec {
  readonly type: EffectType;
  readonly label: string;
  readonly params: readonly ParamSpec[];
  /** Default colour, for effects that have one. */
  readonly color?: Rgba;
  readonly colorLabel?: string;
}

const P = (key: string, label: string, def: number, min: number, max: number, perPx: number, extra: Partial<ParamSpec> = {}): ParamSpec => ({ key, label, def, min, max, perPx, ...extra });

export const EFFECTS: readonly EffectSpec[] = [
  { type: "blur", label: "Blur", params: [P("radius", "Radius", 12, 0, 300, 0.5, { spatial: true })] },
  {
    type: "dropShadow",
    label: "Drop shadow",
    color: [0, 0, 0, 1],
    colorLabel: "Shadow colour",
    params: [
      P("opacity", "Opacity %", 0.6, 0, 1, 0.5, { mul: 100 }),
      P("angle", "Angle °", 135, -360, 360, 1),
      P("distance", "Distance", 24, 0, 600, 0.5, { spatial: true }),
      P("blur", "Blur", 16, 0, 300, 0.5, { spatial: true }),
    ],
  },
  {
    type: "glow",
    label: "Glow",
    color: [1, 0.8, 0.3, 1],
    colorLabel: "Glow colour",
    params: [P("intensity", "Intensity %", 1, 0, 4, 0.5, { mul: 100 }), P("blur", "Blur", 24, 0, 300, 0.5, { spatial: true })],
  },
  {
    type: "noise",
    label: "Noise",
    params: [
      P("amount", "Amount %", 0.2, 0, 1, 0.5, { mul: 100 }),
      P("size", "Grain size", 1, 1, 40, 0.1, { spatial: true }),
      P("mono", "Mono (1) / colour (0)", 1, 0, 1, 0.02),
      P("speed", "Speed (fps, 0 = still)", 24, 0, 60, 0.2),
    ],
  },
  {
    type: "levels",
    label: "Levels",
    params: [
      P("inBlack", "Input black %", 0, 0, 1, 0.25, { mul: 100 }),
      P("inWhite", "Input white %", 1, 0, 1, 0.25, { mul: 100 }),
      P("gamma", "Gamma", 1, 0.1, 4, 0.01),
      P("outBlack", "Output black %", 0, 0, 1, 0.25, { mul: 100 }),
      P("outWhite", "Output white %", 1, 0, 1, 0.25, { mul: 100 }),
    ],
  },
  { type: "brightnessContrast", label: "Brightness / contrast", params: [P("brightness", "Brightness %", 0, -1, 1, 0.25, { mul: 100 }), P("contrast", "Contrast %", 0, -1, 1, 0.25, { mul: 100 })] },
  { type: "exposure", label: "Exposure", params: [P("stops", "Stops", 0, -4, 4, 0.01)] },
  {
    type: "hueSaturation",
    label: "Hue / saturation",
    params: [P("hue", "Hue °", 0, -180, 180, 0.5), P("saturation", "Saturation %", 0, -1, 1, 0.25, { mul: 100 }), P("lightness", "Lightness %", 0, -1, 1, 0.25, { mul: 100 })],
  },
  { type: "tint", label: "Tint", color: [0.25, 0.45, 1, 1], colorLabel: "Tint colour", params: [P("amount", "Amount %", 1, 0, 1, 0.5, { mul: 100 })] },
  { type: "invert", label: "Invert", params: [P("amount", "Amount %", 1, 0, 1, 0.5, { mul: 100 })] },
  { type: "posterize", label: "Posterize", params: [P("levels", "Levels", 4, 2, 32, 0.1)] },
];

export const EFFECT_BY_TYPE: Readonly<Record<EffectType, EffectSpec>> = Object.fromEntries(EFFECTS.map((e) => [e.type, e])) as Record<EffectType, EffectSpec>;

/** A new effect with default values. */
export function newEffect(type: EffectType, id: string): Effect {
  const spec = EFFECT_BY_TYPE[type];
  return {
    id,
    type,
    values: Object.fromEntries(spec.params.map((p) => [p.key, { keys: [{ id: `${id}.${p.key}`, t: 0, value: p.def }] }])),
    ...(spec.color ? { color: spec.color } : {}),
  };
}

/** An effect with its numbers evaluated at one instant, ready for the renderer. */
export interface ResolvedFx {
  readonly type: EffectType;
  readonly v: Readonly<Record<string, number>>;
  readonly color?: Rgba;
  /** Composition time, for effects that animate by themselves (noise). */
  readonly t: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Enabled effects of a layer at time `t`, values clamped to their ranges. */
export function resolveEffects(layer: Layer, t: number): ResolvedFx[] {
  const out: ResolvedFx[] = [];
  for (const e of layer.effects ?? []) {
    if (e.enabled === false) continue;
    const spec = EFFECT_BY_TYPE[e.type];
    if (!spec) continue;
    const v: Record<string, number> = {};
    for (const p of spec.params) v[p.key] = clamp(evalTrack(e.values[p.key] ?? { keys: [] }, t, p.def), p.min, p.max);
    out.push({ type: e.type, v, ...(spec.color ? { color: e.color ?? spec.color } : {}), t });
  }
  return out;
}

/** Spatial values scaled by `k` (device pixels per composition unit). */
export function scaleSpatial(fx: ResolvedFx, k: number): ResolvedFx {
  const spec = EFFECT_BY_TYPE[fx.type];
  const v: Record<string, number> = { ...fx.v };
  for (const p of spec.params) if (p.spatial) v[p.key] = v[p.key]! * k;
  return { ...fx, v };
}
