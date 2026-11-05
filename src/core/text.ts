import { cubicBezier } from "./easing";
import type { TextAnimator, TextUnit } from "./types";

/** A run of the text that animates as one: character offsets [start, end) into the string. */
export interface UnitRange {
  readonly start: number;
  readonly end: number;
}

/** Split text into animation units. Characters skip whitespace; words are whitespace-separated; lines split on \n. */
export function textUnits(text: string, unit: TextUnit): UnitRange[] {
  const out: UnitRange[] = [];
  if (unit === "char") {
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i]!)) out.push({ start: i, end: i + 1 });
    return out;
  }
  if (unit === "line") {
    let s = 0;
    for (let i = 0; i <= text.length; i++) {
      if (i === text.length || text[i] === "\n") {
        if (text.slice(s, i).trim() !== "") out.push({ start: s, end: i });
        s = i + 1;
      }
    }
    return out;
  }
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** How one unit is displaced from its resting place. */
export interface UnitState {
  readonly dx: number;
  readonly dy: number;
  readonly scale: number;
  /** Radians. */
  readonly rotation: number;
  readonly opacity: number;
}

const REST: UnitState = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 };

/** State of every unit at time t. Index i is the i-th unit of `textUnits`. */
export function unitStates(anim: TextAnimator, count: number, t: number): UnitState[] {
  const out: UnitState[] = [];
  const f = anim.from;
  for (let i = 0; i < count; i++) {
    // A negative stagger starts the last unit first.
    const order = anim.stagger >= 0 ? i : count - 1 - i;
    const u = anim.duration > 0 ? (t - anim.start - order * Math.abs(anim.stagger)) / anim.duration : t >= anim.start + order * Math.abs(anim.stagger) ? 1 : 0;
    const e = cubicBezier(anim.ease, Math.min(1, Math.max(0, u)));
    if (e >= 1) {
      out.push(REST);
      continue;
    }
    const k = 1 - e;
    out.push({
      dx: f.dx * k,
      dy: f.dy * k,
      scale: 1 + (f.scale - 1) * k,
      rotation: ((f.rotation * Math.PI) / 180) * k,
      opacity: f.opacity + (1 - f.opacity) * e,
    });
  }
  return out;
}

export const DEFAULT_ANIMATOR: TextAnimator = {
  unit: "char",
  start: 0,
  stagger: 0.05,
  duration: 0.5,
  ease: [0.2, 0.8, 0.2, 1],
  from: { opacity: 0, dx: 0, dy: 60, scale: 1, rotation: 0 },
};
