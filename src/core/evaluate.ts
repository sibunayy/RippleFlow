import { cubicBezier } from "./easing";
import type { Track } from "./types";

/** Value of a track at time t (seconds). Holds first/last value outside range. */
export function evalTrack(track: Track, t: number, fallback = 0): number {
  const keys = track.keys;
  const first = keys[0];
  if (!first) return fallback;
  if (t <= first.t) return first.value;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.value;

  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.t <= t) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const span = b.t - a.t;
  const p = span > 0 ? (t - a.t) / span : 1;
  const e = a.ease ? cubicBezier(a.ease, p) : p;
  return a.value + (b.value - a.value) * e;
}
