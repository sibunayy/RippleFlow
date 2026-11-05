import { addLayer } from "../core/commands";
import type { Command } from "../core/history";
import { displaySize } from "../geometry/layerGeometry";
import { nodesToPath, parseNodes, pathBounds, transformPath, type NodePath } from "../geometry/nodes";
import type { SvgImport } from "../geometry/svgImport";
import { layoutText } from "../text/glyphs";
import { translate } from "../core/affine";
import type { ImageContent, Layer, Rgba, TextContent, Track, VideoContent } from "../core/types";

const empty: Track = { keys: [] };
const still = (v: number): Track => ({ keys: [{ id: `s${v}`, t: 0, value: v }] });

export type ShapeKind = "rect" | "ellipse" | "star" | "rounded" | "triangle" | "hexagon" | "plus" | "arrow" | "heart" | "line";

/** Shapes offered in the toolbar's "More" menu. */
export const MORE_SHAPES: readonly { kind: ShapeKind; label: string }[] = [
  { kind: "rounded", label: "Rounded rect" },
  { kind: "triangle", label: "Triangle" },
  { kind: "hexagon", label: "Hexagon" },
  { kind: "plus", label: "Plus" },
  { kind: "arrow", label: "Arrow" },
  { kind: "heart", label: "Heart" },
  { kind: "line", label: "Line" },
];

const PATHS: Record<ShapeKind, string> = {
  rect: "M0 0 H240 V240 H0 Z",
  ellipse: "M0 120 A120 120 0 1 0 240 120 A120 120 0 1 0 0 120 Z",
  rounded: "M40 0 H200 A40 40 0 0 1 240 40 V200 A40 40 0 0 1 200 240 H40 A40 40 0 0 1 0 200 V40 A40 40 0 0 1 40 0 Z",
  triangle: "M120 10 L230 230 L10 230 Z",
  hexagon: "M240 120 L180 224 L60 224 L0 120 L60 16 L180 16 Z",
  plus: "M80 0 H160 V80 H240 V160 H160 V240 H80 V160 H0 V80 H80 Z",
  arrow: "M0 90 H140 V30 L240 120 L140 210 V150 H0 Z",
  heart: "M120 220 C20 150 0 90 0 60 C0 25 28 0 62 0 C88 0 110 14 120 38 C130 14 152 0 178 0 C212 0 240 25 240 60 C240 90 220 150 120 220 Z",
  line: "M0 0 H240",
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
    name: `${MORE_SHAPES.find((m) => m.kind === kind)?.label ?? `${kind[0]!.toUpperCase()}${kind.slice(1)}`} ${n}`,
    kind: "shape",
    shape: kind === "line" ? { path: PATHS[kind], stroke: { color: [1, 1, 1, 1], width: 12, join: "round", cap: "round" } } : { path: PATHS[kind], fill: PALETTE[n % PALETTE.length]! },
    transform: {
      anchorX: still(120),
      anchorY: still(kind === "line" ? 0 : 120),
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

/**
 * Layers for an imported SVG: a null "group" layer fitted to 70% of the composition, plus one shape layer per
 * element parented to it, each pivoting about its own centre so pieces animate independently.
 * Returns [] when the file has nothing drawable.
 */
export function newSvgLayers(firstN: number, name: string, svg: SvgImport, compW: number, compH: number): Layer[] {
  const items = svg.shapes.map((sh) => ({ sh, nodes: parseNodes(sh.path) }));
  if (items.length === 0) return [];
  const fit = Math.min((0.7 * compW) / svg.width, (0.7 * compH) / svg.height);
  const group: Layer = {
    id: `layer-${firstN}`,
    name,
    kind: "shape",
    transform: {
      anchorX: still(svg.width / 2),
      anchorY: still(svg.height / 2),
      x: still(compW / 2),
      y: still(compH / 2),
      scaleX: still(fit),
      scaleY: still(fit),
      rotation: empty,
      opacity: empty,
    },
  };
  const out: Layer[] = [group];
  items.forEach(({ sh, nodes }, i) => {
    const b = pathBounds(nodes);
    if (!b) return;
    const local = nodes.map((p) => transformPath(p, translate(-b.x, -b.y)));
    out.push({
      id: `layer-${firstN + 1 + i}`,
      name: sh.name,
      kind: "shape",
      parent: group.id,
      shape: { path: nodesToPath(local), ...(sh.fill ? { fill: sh.fill } : {}), ...(sh.gradient ? { gradient: sh.gradient } : {}), ...(sh.stroke ? { stroke: sh.stroke } : {}) },
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
    });
  });
  return out;
}
