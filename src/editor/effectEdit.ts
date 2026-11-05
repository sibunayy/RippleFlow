import { patchEffect } from "../core/commands";
import type { Command } from "../core/history";
import { evalTrack } from "../core/evaluate";
import { EFFECT_BY_TYPE } from "../core/effects";
import type { Id, Rgba } from "../core/types";
import { writeTrack } from "./transformEdit";

/** Set an effect number at time `t` (keyframed when auto-key is on or the number is already animated). */
export function setEffectValue(layerId: Id, effectId: Id, key: string, value: number, t: number, autoKey: boolean): Command {
  return patchEffect(layerId, effectId, "Effect value", (e) => {
    const p = EFFECT_BY_TYPE[e.type].params.find((q) => q.key === key);
    if (!p) throw new Error(`Unknown parameter ${key}`);
    const v = Math.min(p.max, Math.max(p.min, value));
    const track = e.values[key] ?? { keys: [] };
    const before = evalTrack(track, t, p.def);
    if (Math.abs(before - v) < 1e-12 && track.keys.length > 0) return e;
    return { ...e, values: { ...e.values, [key]: writeTrack(track, t, v, autoKey, `${e.id}.${key}@${t.toFixed(4)}`, before) } };
  });
}

export const setEffectColor = (layerId: Id, effectId: Id, color: Rgba): Command => patchEffect(layerId, effectId, "Effect colour", (e) => ({ ...e, color }));
export const setEffectEnabled = (layerId: Id, effectId: Id, on: boolean): Command => patchEffect(layerId, effectId, on ? "Enable effect" : "Disable effect", (e) => ((e.enabled ?? true) === on ? e : { ...e, enabled: on }));
