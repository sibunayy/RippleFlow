import type { Command } from "../core/history";
import type { Bezier } from "../core/types";
import type { KeyRef } from "./keyframeEdit";

export const PRESETS: readonly { name: string; ease: Bezier | undefined }[] = [
  { name: "Linear", ease: undefined },
  { name: "Ease", ease: [0.25, 0.1, 0.25, 1] },
  { name: "Ease in", ease: [0.42, 0, 1, 1] },
  { name: "Ease out", ease: [0, 0, 0.58, 1] },
  { name: "Ease in-out", ease: [0.42, 0, 0.58, 1] },
  { name: "Overshoot", ease: [0.34, 1.56, 0.64, 1] },
  { name: "Anticipate", ease: [0.36, -0.56, 0.64, 1] },
  { name: "Snap", ease: [0.9, 0, 0.1, 1] },
];

/** Keep handle x inside [0, 1] (required for a function of time); y may over/undershoot within [-1, 2]. */
export function clampEase(e: Bezier): Bezier {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return [c(e[0], 0, 1), c(e[1], -1, 2), c(e[2], 0, 1), c(e[3], -1, 2)];
}

const same = (a: Bezier | undefined, b: Bezier | undefined) =>
  a === b || (!!a && !!b && a.every((v, i) => Math.abs(v - b[i]!) < 1e-9));

/**
 * Set (or clear, with undefined) the easing of the segment that starts at each
 * referenced key. Returns the same composition when nothing changes.
 */
export function setEase(refs: readonly KeyRef[], ease: Bezier | undefined): Command {
  const next = ease ? clampEase(ease) : undefined;
  return {
    label: "Set easing",
    apply(comp) {
      let changed = false;
      const layers = comp.layers.map((layer) => {
        const mine = refs.filter((r) => r.layerId === layer.id);
        if (mine.length === 0) return layer;
        let transform = layer.transform;
        for (const prop of new Set(mine.map((r) => r.prop))) {
          const ids = new Set(mine.filter((r) => r.prop === prop).map((r) => r.keyId));
          const track = transform[prop];
          if (!track.keys.some((k) => ids.has(k.id) && !same(k.ease, next))) continue;
          const keys = track.keys.map((k) => {
            if (!ids.has(k.id) || same(k.ease, next)) return k;
            const { ease: _old, ...rest } = k;
            return next ? { ...rest, ease: next } : rest;
          });
          transform = { ...transform, [prop]: { keys } };
          changed = true;
        }
        return transform === layer.transform ? layer : { ...layer, transform };
      });
      return changed ? { ...comp, layers } : comp;
    },
  };
}
