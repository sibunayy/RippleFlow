import { editShape } from "../core/commands";
import type { Command } from "../core/history";
import { evalTrack } from "../core/evaluate";
import type { Id, ShapeContent } from "../core/types";
import { writeTrack } from "./transformEdit";

export type TrimEnd = "start" | "end";
const DEF: Record<TrimEnd, number> = { start: 0, end: 1 };

/** Current trim fraction (0..1) of a shape at time t. Start 0 / end 1 when the shape has no trim. */
export const trimValue = (shape: ShapeContent, which: TrimEnd, t: number): number =>
  Math.min(1, Math.max(0, evalTrack(shape.trim?.[which] ?? { keys: [] }, t, DEF[which])));

/** Set the trim start or end (fraction 0..1) at time t; keyframed when auto-key is on or it is already animated. */
export function setTrim(layerId: Id, which: TrimEnd, value: number, t: number, autoKey: boolean): Command {
  return editShape(layerId, `Trim ${which}`, (shape) => {
    const v = Math.min(1, Math.max(0, value));
    const trim = shape.trim ?? { start: { keys: [] }, end: { keys: [] } };
    const track = trim[which];
    const before = evalTrack(track, t, DEF[which]);
    if (Math.abs(before - v) < 1e-9 && track.keys.length > 0) return shape;
    if (Math.abs(before - v) < 1e-9 && !shape.trim) return shape;
    return { ...shape, trim: { ...trim, [which]: writeTrack(track, t, v, autoKey, `${layerId}.trim.${which}@${t.toFixed(4)}`, before) } };
  });
}
