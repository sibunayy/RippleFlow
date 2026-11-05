import { addLayer } from "../core/commands";
import type { Command } from "../core/history";
import { displaySize } from "../geometry/layerGeometry";
import { nodesToPath, parseNodes, pathBounds, transformPath, type NodePath } from "../geometry/nodes";
import { layoutText } from "../text/glyphs";
import { translate } from "../core/affine";
import type { ImageContent, Layer, Rgba, TextContent, Track, VideoContent } from "../core/types";

const empty: Track = { keys: [] };
const still = (v: number): Track => ({ keys: [{ id: `s${v}`, t: 0, value: v }] });

export type ShapeKind = "rect" | "ellipse" | "star";

const PATHS: Record<ShapeKind, string> = {
  rect: "M0 0 H240 V240 H0 Z",
  ellipse: "M0 120 A120 120 0 1 0 240 120 A120 120 0 1 0 0 120 Z",
  star: "M120 0 L152 86 L240 92 L172 148 L194 236 L120 188 L46 236 L68 148 L0 92 L88 86 Z",
};

const PALETTE: Rgba[] = [
  [0.95, 0.35, 0.3, 1],
  [0.98, 0.72, 0.2, 1],
  [0.3, 0.75, 0.55, 1],
  [0.3, 0.55, 0.95, 1],
  [0.7, 0.45, 0.95, 1],
];

/** A new shape layer centred on the composition, coloured by creation order. */
export function newShapeLayer(kind: ShapeKind, n: number, compW: number, compH: number): Layer {
  return {
    id: `layer-${n}`,
    name: `${kind[0]!.toUpperCase()}${kind.slice(1)} ${n}`,
    kind: "shape",
    shape: { path: PATHS[kind], fill: PALETTE[n % PALETTE.length]! },
    transform: {
      anchorX: still(120),
      anchorY: still(120),
      x: still(compW / 2),
      y: still(compH / 2),
      scaleX: empty,
      scaleY: empty,
      rotation: empty,
      opacity: empty,
    },
  };
}

export const addShape = (kind: ShapeKind, n: number, w: number, h: number): Command => addLayer(newShapeLayer(kind, n, w, h));

/** An image layer centred on the composition, scaled to fit within 60% of it, rotating about its own centre. */
export function newImageLayer(n: number, name: string, image: ImageContent, compW: number, compH: number): Layer {
  const fit = Math.min((0.6 * compW) / image.width, (0.6 * compH) / image.height);
  return {
    id: `layer-${n}`,
    name,
    kind: "image",
    image,
    transform: {
      anchorX: still(image.width / 2),
      anchorY: still(image.height / 2),
      x: still(compW / 2),
      y: still(compH / 2),
      scaleX: still(fit),
      scaleY: still(fit),
      rotation: empty,
      opacity: empty,
    },
  };
}

/**
 * A video layer centred on the composition, fitted inside it, visible from where the
 * clip starts until it ends (or the composition does).
 */
export function newVideoLayer(n: number, name: string, video: VideoContent, compW: number, compH: number, compDuration: number): Layer {
  const { width, height } = displaySize(video);
  const fit = Math.min(compW / width, compH / height);
  return {
    id: `layer-${n}`,
    name,
    kind: "video",
    video,
    inPoint: video.start,
    outPoint: Math.min(compDuration, video.start + video.duration),
    transform: {
      anchorX: still(width / 2),
      anchorY: still(height / 2),
      x: still(compW / 2),
      y: still(compH / 2),
      scaleX: still(fit),
      scaleY: still(fit),
      rotation: empty,
      opacity: empty,
    },
  };
}

/** Next unused "layer-N" number, so ids stay unique after loading a saved project. */
export function nextLayerNumber(layers: readonly { id: string }[]): number {
  let max = 0;
  for (const l of layers) {
    const m = /^layer-(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * A shape layer from a drawn path (composition coordinates). The layer's box is the path's box and it
 * rotates and scales about its centre. Closed paths are filled; open ones are a rounded white stroke.
 */
export function newPathLayer(n: number, path: NodePath): Layer | null {
  const b = pathBounds([path]);
  if (!b) return null;
  const local = transformPath(path, translate(-b.x, -b.y));
  return {
    id: `layer-${n}`,
    name: `Path ${n}`,
    kind: "shape",
    shape: {
      path: nodesToPath([local]),
      ...(path.closed ? { fill: PALETTE[n % PALETTE.length]! } : { stroke: { color: [1, 1, 1, 1], width: 8, join: "round", cap: "round" } }),
    },
    transform: {
      anchorX: still(b.w / 2),
      anchorY: still(b.h / 2),
      x: still(b.x + b.w / 2),
      y: still(b.y + b.h / 2),
      scaleX: empty,
      scaleY: empty,
      rotation: empty,
      opacity: empty,
    },
  };
}

/** An empty layer with a transform and nothing to draw: parent other layers to it to move them together. */
export function newNullLayer(n: number, compW: number, compH: number): Layer {
  return {
    id: `layer-${n}`,
    name: `Null ${n}`,
    kind: "shape",
    transform: { anchorX: empty, anchorY: empty, x: still(compW / 2), y: still(compH / 2), scaleX: empty, scaleY: empty, rotation: empty, opacity: empty },
  };
}

/** A white text layer centred on the composition. Its outlines come from the loaded font. */
export function newTextLayer(n: number, text: string, compW: number, compH: number): Layer | null {
  const content: TextContent = { text, size: 160, tracking: 0, align: "center" };
  const { path } = layoutText(content);
  const b = pathBounds(parseNodes(path));
  if (!b) return null;
  return {
    id: `layer-${n}`,
    name: `Text ${n}`,
    kind: "shape",
    text: content,
    shape: { path, fill: [1, 1, 1, 1] },
    transform: {
      anchorX: still(b.x + b.w / 2),
      anchorY: still(b.y + b.h / 2),
      x: still(compW / 2),
      y: still(compH / 2),
      scaleX: empty,
      scaleY: empty,
      rotation: empty,
      opacity: empty,
    },
  };
}
