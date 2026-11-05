import type { ShapeContent } from "../core/types";
import type { Bounds } from "../editor/hitTest";
import { tessellateFill } from "./fill";
import { flatten } from "./path";
import type { Mesh } from "./mesh";
import { tessellateStroke } from "./stroke";
import { parseSvgPath } from "./svgPath";

export interface ShapePart {
  readonly mesh: Mesh;
  readonly color: readonly [number, number, number, number];
}

export interface ShapeGeometry {
  /** Fill first, then stroke on top. */
  readonly parts: readonly ShapePart[];
  /** Local-space box including stroke reach; undefined for empty geometry. */
  readonly bounds: Bounds | undefined;
}

/**
 * Tessellate a shape layer once in local space. Layers are drawn through a
 * per-draw transform, so animation never re-runs this; only a content edit
 * (or zooming past `tolerance`) does.
 */
export function buildShapeGeometry(shape: ShapeContent, tolerance = 0.1): ShapeGeometry {
  const subpaths = flatten(parseSvgPath(shape.path), tolerance);
  const parts: ShapePart[] = [];
  if (shape.fill) parts.push({ mesh: tessellateFill(subpaths), color: shape.fill });
  if (shape.stroke) {
    const s = shape.stroke;
    parts.push({
      mesh: tessellateStroke(subpaths, {
        width: s.width,
        join: s.join ?? "miter",
        cap: s.cap ?? "butt",
        miterLimit: 4,
        tolerance,
      }),
      color: s.color,
    });
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { mesh } of parts) {
    const p = mesh.positions;
    for (let i = 0; i < p.length; i += 2) {
      minX = Math.min(minX, p[i]!);
      maxX = Math.max(maxX, p[i]!);
      minY = Math.min(minY, p[i + 1]!);
      maxY = Math.max(maxY, p[i + 1]!);
    }
  }
  const bounds = minX <= maxX ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : undefined;
  return { parts, bounds };
}
