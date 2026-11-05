import { IDENTITY, type Affine } from "../core/affine";
import type { Gradient, ImageContent, Layer, ShapeContent, VideoContent } from "../core/types";
import type { Bounds } from "../editor/hitTest";
import { tessellateFill } from "./fill";
import { flatten } from "./path";
import type { Mesh } from "./mesh";
import { rectMesh } from "./rect";
import { tessellateStroke } from "./stroke";
import { trimSubpaths } from "./trim";
import { parseSvgPath } from "./svgPath";
import { fontLoaded, layoutText, type LaidOutUnit } from "../text/glyphs";

export interface ShapePart {
  readonly mesh: Mesh;
  readonly color: readonly [number, number, number, number];
  /** Draw this picture across the mesh instead of the flat color. */
  readonly image?: ImageBitmap;
  /** This part shows a video frame (supplied per frame by the media provider, not stored here). */
  readonly video?: true;
  /** Mesh to layer-local transform (used to rotate sideways-coded video). Defaults to identity. */
  readonly local?: Affine;
  /**
   * Stroke parts only: the stroke mesh for a layer whose world scale is (sx, sy), built so the line is the
   * same thickness in every direction (width times the geometric mean scale). Returns the mesh in
   * scaled space; draw it with the layer matrix divided by (sx, sy).
   */
  readonly strokeAt?: (sx: number, sy: number) => Mesh;
  /** Stroke parts only: the stroke of just the stretch between two fractions of its length (trim paths), for a layer of world scale (sx, sy) as in `strokeAt`. */
  readonly trimAt?: (start: number, end: number, sx: number, sy: number) => Mesh;
  /** Picture with puppet pins: the mesh is rebuilt from the pins each frame (size of the picture in pixels). */
  readonly warp?: { readonly w: number; readonly h: number };
  /** Text layers with an animator: which character/word/line this part belongs to, and the point it turns and scales about. */
  readonly unit?: number;
  readonly pivot?: readonly [number, number];
  /** Paint this gradient over `bbox` instead of the flat color. */
  readonly gradient?: { readonly gradient: Gradient; readonly bbox: { x: number; y: number; w: number; h: number } };
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
  if (shape.fill || shape.gradient) {
    const mesh = tessellateFill(subpaths);
    const color = shape.fill ?? shape.gradient!.stops[0]!.color;
    if (shape.gradient) {
      const bb = meshBounds(mesh);
      parts.push({ mesh, color, gradient: { gradient: shape.gradient, bbox: bb ?? { x: 0, y: 0, w: 1, h: 1 } } });
    } else parts.push({ mesh, color });
  }
  if (shape.stroke) {
    const s = shape.stroke;
    const strokeOpts = { join: s.join ?? "miter", cap: s.cap ?? "butt", miterLimit: 4, tolerance } as const;
    const cache = new Map<string, Mesh>();
    parts.push({
      mesh: tessellateStroke(subpaths, { width: s.width, ...strokeOpts }),
      color: s.color,
      strokeAt: (sx, sy) => {
        const key = `${sx.toFixed(3)},${sy.toFixed(3)}`;
        let m = cache.get(key);
        if (!m) {
          const k = Math.sqrt(sx * sy);
          const scaled = subpaths.map((sp) => ({ ...sp, points: sp.points.map((v, i) => v * (i % 2 ? sy : sx)) }));
          m = tessellateStroke(scaled, { width: s.width * k, ...strokeOpts, tolerance: tolerance * Math.max(sx, sy) });
          if (cache.size >= 8) cache.delete(cache.keys().next().value!);
          cache.set(key, m);
        }
        return m;
      },
      ...(shape.trim
        ? {
            trimAt: (() => {
              const last = new Map<string, Mesh>();
              return (start: number, end: number, sx: number, sy: number): Mesh => {
                const key = `${start.toFixed(4)},${end.toFixed(4)},${sx.toFixed(3)},${sy.toFixed(3)}`;
                let m = last.get(key);
                if (!m) {
                  const k = Math.sqrt(sx * sy);
                  const scaled = subpaths.map((sp) => ({ ...sp, points: sp.points.map((v, i) => v * (i % 2 ? sy : sx)) }));
                  m = tessellateStroke(trimSubpaths(scaled, start, end), { width: s.width * k, ...strokeOpts, tolerance: tolerance * Math.max(sx, sy) });
                  if (last.size >= 8) last.delete(last.keys().next().value!);
                  last.set(key, m);
                }
                return m;
              };
            })(),
          }
        : {}),
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

function meshBounds(mesh: Mesh): { x: number; y: number; w: number; h: number } | undefined {
  const p = mesh.positions;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]!);
    maxX = Math.max(maxX, p[i]!);
    minY = Math.min(minY, p[i + 1]!);
    maxY = Math.max(maxY, p[i + 1]!);
  }
  return minX <= maxX ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : undefined;
}

const MISSING: readonly [number, number, number, number] = [0.4, 0.4, 0.45, 1];

/**
 * Geometry for an image layer. While the picture is still loading (or failed to
 * load) the layer shows a grey placeholder of the right size, so it can still be
 * selected and moved.
 */
export function buildImageGeometry(image: ImageContent, bitmap: ImageBitmap | undefined): ShapeGeometry {
  const mesh = rectMesh(image.width, image.height);
  const warp = image.pins?.length ? { warp: { w: image.width, h: image.height } } : {};
  return {
    parts: [bitmap ? { mesh, color: [1, 1, 1, 1], image: bitmap, ...warp } : { mesh, color: MISSING }],
    bounds: { x: 0, y: 0, w: image.width, h: image.height },
  };
}

/** Where the coded rectangle lands after the file's clockwise rotation, so it fills the display rectangle. */
export function rotationMatrix(rotation: VideoContent["rotation"], codedW: number, codedH: number): Affine {
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, codedH, 0];
    case 180:
      return [-1, 0, 0, -1, codedW, codedH];
    case 270:
      return [0, -1, 1, 0, 0, codedW];
    default:
      return IDENTITY;
  }
}

/** Size of the clip as shown (after rotation). */
export const displaySize = (v: Pick<VideoContent, "codedWidth" | "codedHeight" | "rotation">): { width: number; height: number } =>
  v.rotation === 90 || v.rotation === 270 ? { width: v.codedHeight, height: v.codedWidth } : { width: v.codedWidth, height: v.codedHeight };

/** A video layer is the coded rectangle (rotated into place); the frames themselves arrive per frame from the media provider. */
export function buildVideoGeometry(video: VideoContent): ShapeGeometry {
  const { width, height } = displaySize(video);
  return {
    parts: [{ mesh: rectMesh(video.codedWidth, video.codedHeight), color: [0, 0, 0, 1], video: true, local: rotationMatrix(video.rotation, video.codedWidth, video.codedHeight) }],
    bounds: { x: 0, y: 0, w: width, h: height },
  };
}

/** Geometry for any layer kind. `bitmapOf` resolves an image asset id once it has loaded. */
/** Geometry for animated text: one set of parts per unit, so each can move on its own. */
export function buildTextGeometry(shape: ShapeContent, units: readonly LaidOutUnit[]): ShapeGeometry {
  const parts: ShapePart[] = [];
  let bounds: Bounds | undefined;
  units.forEach((u, i) => {
    if (u.path === "") return;
    const g = buildShapeGeometry({ ...shape, path: u.path });
    for (const p of g.parts) parts.push({ ...p, unit: i, pivot: u.pivot });
    if (g.bounds) {
      const b = g.bounds;
      bounds = bounds ? { x: Math.min(bounds.x, b.x), y: Math.min(bounds.y, b.y), w: Math.max(bounds.x + bounds.w, b.x + b.w) - Math.min(bounds.x, b.x), h: Math.max(bounds.y + bounds.h, b.y + b.h) - Math.min(bounds.y, b.y) } : b;
    }
  });
  // A gradient spans the whole text, not each letter.
  const boxes = parts.flatMap((p) => (p.gradient ? [p.gradient.bbox] : []));
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const whole = { x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 };
    parts.forEach((p, i) => {
      if (p.gradient) parts[i] = { ...p, gradient: { ...p.gradient, bbox: whole } };
    });
  }
  return { parts, bounds };
}

export function buildLayerGeometry(layer: Layer, bitmapOf: (asset: string) => ImageBitmap | undefined): ShapeGeometry | undefined {
  if (layer.shape && layer.text?.animator && fontLoaded()) return buildTextGeometry(layer.shape, layoutText(layer.text).units);
  if (layer.shape) return buildShapeGeometry(layer.shape);
  if (layer.image) return buildImageGeometry(layer.image, bitmapOf(layer.image.asset));
  if (layer.video) return buildVideoGeometry(layer.video);
  return undefined;
}
