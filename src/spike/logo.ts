import { tessellateFill } from "../geometry/fill";
import { localTolerance } from "../geometry/lod";
import { flatten } from "../geometry/path";
import { tessellateStroke, type StrokeStyle } from "../geometry/stroke";
import { parseSvgPath } from "../geometry/svgPath";
import type { Draw } from "../render/meshRenderer";

/** Test logo in a 512x512 space. Exercises arcs, holes, islands, curves, joins and caps. */
const SHAPES: Array<{
  d: string;
  fill?: Draw["color"];
  stroke?: { color: Draw["color"]; style: StrokeStyle };
}> = [
  // Ring: outer and inner circle as arcs (even-odd hole).
  {
    d: "M 76 256 A 180 180 0 1 1 436 256 A 180 180 0 1 1 76 256 Z M 136 256 A 120 120 0 1 0 376 256 A 120 120 0 1 0 136 256 Z",
    fill: [0.12, 0.31, 0.85, 1],
  },
  // Island inside the hole.
  { d: "M 226 226 L 286 226 L 286 286 L 226 286 Z", fill: [0.98, 0.78, 0.15, 1] },
  // Wave: smooth cubics, thick stroke, round joins and caps.
  {
    d: "M 96 330 C 150 250 210 250 256 330 S 362 410 416 330",
    stroke: { color: [1, 0.42, 0.2, 1], style: { width: 26, join: "round", cap: "round" } },
  },
  // Sharp star outline: miter joins with a limit.
  {
    d: "M 256 70 L 281 128 L 345 134 L 297 176 L 311 238 L 256 206 L 201 238 L 215 176 L 167 134 L 231 128 Z",
    stroke: { color: [0.05, 0.05, 0.1, 1], style: { width: 7, join: "miter", miterLimit: 6 } },
  },
  // Thin open zigzag with bevel joins and square caps.
  {
    d: "M 60 470 L 110 440 L 160 470 L 210 440 L 260 470",
    stroke: { color: [0.2, 0.7, 0.4, 1], style: { width: 10, join: "bevel", cap: "square" } },
  },
];

/** Size of the logo's local coordinate space. */
export const LOGO_SIZE = 512;

/**
 * Tessellate the logo once in its own 512x512 space. `maxScale` is the largest
 * local-to-pixel scale it will be drawn at; it sets the flattening tolerance.
 * Position, rotation and scale are applied later through each draw's transform.
 */
export function buildLogo(maxScale: number): Draw[] {
  const tol = localTolerance(maxScale);
  const draws: Draw[] = [];
  for (const sh of SHAPES) {
    const subs = flatten(parseSvgPath(sh.d), tol);
    if (sh.fill) draws.push({ mesh: tessellateFill(subs), color: sh.fill });
    if (sh.stroke) {
      draws.push({ mesh: tessellateStroke(subs, { ...sh.stroke.style, tolerance: tol }), color: sh.stroke.color });
    }
  }
  return draws;
}
