import { editShape } from "../core/commands";
import type { Command } from "../core/history";
import { MAX_GRADIENT_STOPS, type Gradient, type GradientStop, type Id, type Rgba, type ShapeContent } from "../core/types";
import { darken } from "./color";

export type FillMode = "none" | "solid" | "linear" | "radial";

export const fillModeOf = (s: ShapeContent): FillMode => (s.gradient ? s.gradient.kind : s.fill ? "solid" : "none");

const DEFAULT_FILL: Rgba = [0.3, 0.55, 0.95, 1];
export const DEFAULT_STROKE = { color: [1, 1, 1, 1] as Rgba, width: 8 };

/** The flat colour to show for the fill: the solid fill, else the gradient's first stop. */
export const fillColorOf = (s: ShapeContent): Rgba => s.fill ?? s.gradient?.stops[0]?.color ?? DEFAULT_FILL;

/** Switch between none / solid / linear / radial. The solid colour is kept so switching back restores it. */
export function setFillMode(id: Id, mode: FillMode): Command {
  return editShape(id, "Fill type", (s) => {
    if (fillModeOf(s) === mode) return s;
    const { gradient: _g, fill, ...rest } = s;
    if (mode === "none") return rest;
    if (mode === "solid") return { ...rest, fill: fill ?? s.gradient?.stops[0]?.color ?? DEFAULT_FILL };
    const base = fillColorOf(s);
    const gradient: Gradient = s.gradient
      ? { ...s.gradient, kind: mode }
      : { kind: mode, angle: 0, stops: [{ offset: 0, color: base }, { offset: 1, color: darken(base, 0.35) }] };
    return { ...rest, fill: fill ?? base, gradient };
  });
}

export const setFillColor = (id: Id, color: Rgba): Command => editShape(id, "Fill colour", (s) => ({ ...s, fill: color }));

const withStops = (g: Gradient, stops: readonly GradientStop[]): Gradient => ({ ...g, stops: [...stops].sort((a, b) => a.offset - b.offset) });

const onGradient = (id: Id, label: string, edit: (g: Gradient) => Gradient): Command =>
  editShape(id, label, (s) => {
    if (!s.gradient) throw new Error("This shape has no gradient");
    const g = edit(s.gradient);
    return g === s.gradient ? s : { ...s, gradient: g };
  });

export const setGradientAngle = (id: Id, angle: number): Command => onGradient(id, "Gradient angle", (g) => ({ ...g, angle }));

export const setStopColor = (id: Id, index: number, color: Rgba): Command =>
  onGradient(id, "Gradient colour", (g) => {
    if (!g.stops[index]) throw new Error("No such stop");
    return { ...g, stops: g.stops.map((st, i) => (i === index ? { ...st, color } : st)) };
  });

/** Move a stop. It is clamped to 0..1 and the list is re-sorted, so the caller must not assume the index survives. */
export const setStopOffset = (id: Id, index: number, offset: number): Command =>
  onGradient(id, "Gradient stop", (g) => {
    if (!g.stops[index]) throw new Error("No such stop");
    return withStops(g, g.stops.map((st, i) => (i === index ? { ...st, offset: Math.min(1, Math.max(0, offset)) } : st)));
  });

/** Insert a stop halfway between `index` and the next one, coloured by blending the two. */
export const addStopAfter = (id: Id, index: number): Command =>
  onGradient(id, "Add gradient stop", (g) => {
    if (g.stops.length >= MAX_GRADIENT_STOPS) throw new Error(`At most ${MAX_GRADIENT_STOPS} colours`);
    const a = g.stops[index];
    const b = g.stops[index + 1] ?? a;
    if (!a || !b) throw new Error("No such stop");
    const mid: GradientStop = {
      offset: index + 1 < g.stops.length ? (a.offset + b.offset) / 2 : Math.min(1, a.offset + (1 - a.offset) / 2),
      color: [0, 1, 2, 3].map((k) => (a.color[k]! + b.color[k]!) / 2) as unknown as Rgba,
    };
    return withStops(g, [...g.stops, mid]);
  });

export const removeStop = (id: Id, index: number): Command =>
  onGradient(id, "Remove gradient stop", (g) => {
    if (g.stops.length <= 2) throw new Error("A gradient needs at least two colours");
    return { ...g, stops: g.stops.filter((_, i) => i !== index) };
  });

export const setStrokeEnabled = (id: Id, on: boolean): Command =>
  editShape(id, on ? "Add stroke" : "Remove stroke", (s) => {
    if (on) return s.stroke ? s : { ...s, stroke: { ...DEFAULT_STROKE } };
    if (!s.stroke) return s;
    const { stroke: _s, ...rest } = s;
    return rest;
  });

type Stroke = NonNullable<ShapeContent["stroke"]>;
export const patchStroke = (id: Id, label: string, patch: Partial<Stroke>): Command =>
  editShape(id, label, (s) => {
    const base = s.stroke ?? { ...DEFAULT_STROKE };
    const next = { ...base, ...patch };
    if (!(next.width > 0)) throw new Error("Stroke width must be positive");
    return { ...s, stroke: next };
  });
