import type { Mask } from "../core/types";
import { patchMask } from "../core/commands";
import type { Command } from "../core/history";
import type { Bounds } from "./hitTest";

/** A rectangle or ellipse mask inside the layer's box (10% inset), as path data in layer coordinates. */
export function maskPresetPath(kind: "rect" | "ellipse", b: Bounds): string {
  const x = b.x + b.w * 0.1;
  const y = b.y + b.h * 0.1;
  const w = b.w * 0.8;
  const h = b.h * 0.8;
  if (kind === "rect") return `M${r(x)} ${r(y)}L${r(x + w)} ${r(y)}L${r(x + w)} ${r(y + h)}L${r(x)} ${r(y + h)}Z`;
  const k = 0.5522847498;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  return (
    `M${r(cx + rx)} ${r(cy)}` +
    `C${r(cx + rx)} ${r(cy + ry * k)} ${r(cx + rx * k)} ${r(cy + ry)} ${r(cx)} ${r(cy + ry)}` +
    `C${r(cx - rx * k)} ${r(cy + ry)} ${r(cx - rx)} ${r(cy + ry * k)} ${r(cx - rx)} ${r(cy)}` +
    `C${r(cx - rx)} ${r(cy - ry * k)} ${r(cx - rx * k)} ${r(cy - ry)} ${r(cx)} ${r(cy - ry)}` +
    `C${r(cx + rx * k)} ${r(cy - ry)} ${r(cx + rx)} ${r(cy - ry * k)} ${r(cx + rx)} ${r(cy)}Z`
  );
}
const r = (v: number) => Math.round(v * 100) / 100;

export const newMask = (id: string, path: string): Mask => ({ id, path, mode: "add", feather: 0, opacity: 1 });

export const setMaskMode = (layerId: string, maskId: string, mode: Mask["mode"]): Command => patchMask(layerId, maskId, "Mask mode", (m) => (m.mode === mode ? m : { ...m, mode }));
export const setMaskFeather = (layerId: string, maskId: string, feather: number): Command => patchMask(layerId, maskId, "Mask feather", (m) => (m.feather === feather ? m : { ...m, feather: Math.max(0, feather) }));
export const setMaskOpacity = (layerId: string, maskId: string, opacity: number): Command => patchMask(layerId, maskId, "Mask opacity", (m) => (m.opacity === opacity ? m : { ...m, opacity: Math.min(1, Math.max(0, opacity)) }));
export const setMaskInverted = (layerId: string, maskId: string, inverted: boolean): Command =>
  patchMask(layerId, maskId, "Invert mask", (m) => {
    if (!!m.inverted === inverted) return m;
    const { inverted: _i, ...rest } = m;
    return inverted ? { ...rest, inverted: true } : rest;
  });
