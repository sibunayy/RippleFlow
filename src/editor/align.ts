import type { Affine } from "../core/affine";
import type { Bounds } from "./hitTest";
import { worldCorners } from "./handles";

export type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

export const ALIGN_MODES: readonly { mode: AlignMode; label: string; title: string }[] = [
  { mode: "left", label: "⇤", title: "Align left" },
  { mode: "centerX", label: "↔", title: "Centre horizontally" },
  { mode: "right", label: "⇥", title: "Align right" },
  { mode: "top", label: "⤒", title: "Align top" },
  { mode: "centerY", label: "↕", title: "Centre vertically" },
  { mode: "bottom", label: "⤓", title: "Align bottom" },
];

/** Axis-aligned box of a layer-local box after `matrix`. */
export function worldBox(b: Bounds, matrix: Affine): Bounds {
  const c = worldCorners(b, matrix);
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBox(boxes: readonly Bounds[]): Bounds | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** Translation (composition space) that aligns `box` to the composition edge or centre. */
export function alignDelta(box: Bounds, mode: AlignMode, compW: number, compH: number): [number, number] {
  switch (mode) {
    case "left": return [-box.x, 0];
    case "centerX": return [compW / 2 - (box.x + box.w / 2), 0];
    case "right": return [compW - (box.x + box.w), 0];
    case "top": return [0, -box.y];
    case "centerY": return [0, compH / 2 - (box.y + box.h / 2)];
    case "bottom": return [0, compH - (box.y + box.h)];
  }
}
