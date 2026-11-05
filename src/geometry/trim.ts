import type { Subpath } from "./path";

/** Total outline length of the subpaths (a closed subpath includes its closing segment). */
export function pathLength(subpaths: readonly Subpath[]): number {
  let total = 0;
  for (const sp of subpaths) total += subLength(sp);
  return total;
}

function pts(sp: Subpath): number[] {
  return sp.closed && sp.points.length >= 4 ? [...sp.points, sp.points[0]!, sp.points[1]!] : sp.points;
}

function subLength(sp: Subpath): number {
  const p = pts(sp);
  let len = 0;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  return len;
}

/**
 * Keep only the part of the outline between fractions `start` and `end` (0..1 of the total length,
 * measured across all subpaths in order). Whole closed subpaths stay closed; partial ones become open lines.
 */
export function trimSubpaths(subpaths: readonly Subpath[], start: number, end: number): Subpath[] {
  const s = Math.min(1, Math.max(0, start));
  const e = Math.min(1, Math.max(0, end));
  if (e - s <= 1e-9) return [];
  if (s <= 1e-9 && e >= 1 - 1e-9) return subpaths.map((sp) => ({ points: [...sp.points], closed: sp.closed }));
  const total = pathLength(subpaths);
  if (total <= 0) return [];
  const a = s * total;
  const b = e * total;
  const out: Subpath[] = [];
  let offset = 0;
  for (const sp of subpaths) {
    const len = subLength(sp);
    const lo = Math.max(a, offset) - offset;
    const hi = Math.min(b, offset + len) - offset;
    const whole = lo <= 1e-9 && hi >= len - 1e-9;
    if (whole) out.push({ points: [...sp.points], closed: sp.closed });
    else if (hi - lo > 1e-9) out.push({ points: slice(pts(sp), lo, hi), closed: false });
    offset += len;
  }
  return out;
}

/** The polyline between arc lengths lo and hi. */
function slice(p: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  let at = 0;
  const push = (x: number, y: number) => {
    const n = out.length;
    if (n >= 2 && Math.hypot(x - out[n - 2]!, y - out[n - 1]!) < 1e-9) return;
    out.push(x, y);
  };
  for (let i = 2; i < p.length; i += 2) {
    const x0 = p[i - 2]!, y0 = p[i - 1]!, x1 = p[i]!, y1 = p[i + 1]!;
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg > 0 && at + seg > lo && at < hi) {
      const t0 = Math.max(0, (lo - at) / seg);
      const t1 = Math.min(1, (hi - at) / seg);
      push(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0);
      push(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
    }
    at += seg;
  }
  return out;
}
