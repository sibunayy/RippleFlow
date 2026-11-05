import { editLayer } from "../core/commands";
import type { Command } from "../core/history";
import { evalTrack } from "../core/evaluate";
import type { Layer, Pin } from "../core/types";
import { writeTrack } from "./transformEdit";

const withPins = (layer: Layer, pins: readonly Pin[]): Layer => {
  if (!layer.image) throw new Error(`Layer ${layer.id} is not a picture`);
  return { ...layer, image: { ...layer.image, pins } };
};

/** Pin a point of the picture (picture pixels). It starts with no pull. */
export const addPin = (layerId: string, pin: { id: string; x: number; y: number }): Command =>
  editLayer(layerId, "Add pin", (l) => withPins(l, [...(l.image?.pins ?? []), { ...pin, dx: { keys: [] }, dy: { keys: [] } }]));

export const removePin = (layerId: string, pinId: string): Command =>
  editLayer(layerId, "Remove pin", (l) => {
    const pins = (l.image?.pins ?? []).filter((p) => p.id !== pinId);
    if (pins.length === (l.image?.pins ?? []).length) return l;
    if (!l.image) return l;
    const { pins: _gone, ...rest } = l.image;
    return { ...l, image: pins.length ? { ...rest, pins } : rest };
  });

/** Pull a pin to offset (dx, dy) at time t (keyframed when auto-key is on or the pin is already animated). */
export const movePin = (layerId: string, pinId: string, dx: number, dy: number, t: number, autoKey: boolean): Command =>
  editLayer(layerId, "Move pin", (l) =>
    withPins(
      l,
      (l.image?.pins ?? []).map((p) => {
        if (p.id !== pinId) return p;
        const tag = t.toFixed(4);
        return {
          ...p,
          dx: writeTrack(p.dx, t, dx, autoKey, `${p.id}.dx@${tag}`, evalTrack(p.dx, t, 0)),
          dy: writeTrack(p.dy, t, dy, autoKey, `${p.id}.dy@${tag}`, evalTrack(p.dy, t, 0)),
        };
      }),
    ),
  );
