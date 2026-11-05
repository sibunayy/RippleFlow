/**
 * Dragging across a number to change it. Pure so it can be tested without a DOM.
 * `perPx` is the value change per horizontal pixel. Dragging well away from the
 * field vertically switches to fine mode (a tenth of the speed) for precision.
 */
export const FINE_DISTANCE = 60;

export interface ScrubOptions {
  readonly perPx: number;
  readonly min?: number;
  readonly max?: number;
  /** Decimals to keep. */
  readonly decimals?: number;
}

export function scrubValue(start: number, dx: number, dy: number, o: ScrubOptions): number {
  const k = Math.abs(dy) > FINE_DISTANCE ? 0.1 : 1;
  let v = start + dx * o.perPx * k;
  if (o.min !== undefined) v = Math.max(o.min, v);
  if (o.max !== undefined) v = Math.min(o.max, v);
  const f = 10 ** (o.decimals ?? 2);
  return Math.round(v * f) / f;
}

/** Movement under this many pixels is a tap (type a value), not a drag. */
export const TAP_SLOP = 5;
