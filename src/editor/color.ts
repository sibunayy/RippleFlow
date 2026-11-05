import type { Rgba } from "../core/types";

const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");

/** "#rrggbb" for the colour pickers (alpha is edited separately). */
export const rgbToHex = (c: Rgba): string => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;

/** Parse "#rrggbb" (or "#rgb"); null if it is neither. Keeps the given alpha. */
export function hexToRgba(hex: string, alpha = 1): Rgba | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), alpha];
}

export const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], Math.min(1, Math.max(0, a))];
export const darken = (c: Rgba, k: number): Rgba => [c[0] * k, c[1] * k, c[2] * k, c[3]];
