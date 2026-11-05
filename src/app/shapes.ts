import { addLayer } from "../core/commands";
import type { Command } from "../core/history";
import type { Layer, Rgba, Track } from "../core/types";

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

/** Next unused "layer-N" number, so ids stay unique after loading a saved project. */
export function nextLayerNumber(layers: readonly { id: string }[]): number {
  let max = 0;
  for (const l of layers) {
    const m = /^layer-(\d+)$/.exec(l.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
