import type { Command } from "./history";
import type { Composition, Id, Keyframe, Layer, Track, Transform } from "./types";

const find = (comp: Composition, id: Id): Layer => {
  const layer = comp.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`Unknown layer ${id}`);
  return layer;
};

const replaceLayer = (comp: Composition, layer: Layer): Composition => ({
  ...comp,
  layers: comp.layers.map((l) => (l.id === layer.id ? layer : l)),
});

export type TransformProp = keyof Transform;

/** Insert a layer at `index` (default: on top). */
export function addLayer(layer: Layer, index?: number): Command {
  return {
    label: `Add layer ${layer.name}`,
    apply(comp) {
      if (comp.layers.some((l) => l.id === layer.id)) throw new Error(`Layer ${layer.id} already exists`);
      const at = Math.min(Math.max(index ?? comp.layers.length, 0), comp.layers.length);
      const layers = [...comp.layers.slice(0, at), layer, ...comp.layers.slice(at)];
      return { ...comp, layers };
    },
  };
}

/**
 * Remove a layer. Its children are re-attached to the removed layer's parent
 * (or become top-level). Their own transform values are not compensated, so a
 * child can visibly jump if the removed parent was moving it.
 */
export function removeLayer(id: Id): Command {
  return {
    label: "Delete layer",
    apply(comp) {
      const doomed = find(comp, id);
      const layers = comp.layers
        .filter((l) => l.id !== id)
        .map((l) => {
          if (l.parent !== id) return l;
          const { parent: _gone, ...rest } = l;
          return doomed.parent !== undefined ? { ...rest, parent: doomed.parent } : rest;
        });
      return { ...comp, layers };
    },
  };
}

/** Move a layer to `toIndex` in the stack (0 = bottom). */
export function moveLayer(id: Id, toIndex: number): Command {
  return {
    label: "Reorder layer",
    apply(comp) {
      const from = comp.layers.findIndex((l) => l.id === id);
      if (from < 0) throw new Error(`Unknown layer ${id}`);
      const to = Math.min(Math.max(toIndex, 0), comp.layers.length - 1);
      if (to === from) return comp;
      const layers = [...comp.layers];
      const [item] = layers.splice(from, 1);
      layers.splice(to, 0, item!);
      return { ...comp, layers };
    },
  };
}

/** Set or clear (undefined) a layer's parent. Throws if that would create a cycle. */
export function setParent(id: Id, parent: Id | undefined): Command {
  return {
    label: "Set parent",
    apply(comp) {
      const layer = find(comp, id);
      if (layer.parent === parent) return comp;
      if (parent !== undefined) {
        find(comp, parent);
        // Walk up from the proposed parent; reaching `id` means a cycle.
        for (let cur: Id | undefined = parent, n = 0; cur !== undefined; n++) {
          if (cur === id) throw new Error(`Parenting ${id} to ${parent} would create a cycle`);
          if (n > comp.layers.length) throw new Error("Existing parent cycle");
          cur = find(comp, cur).parent;
        }
      }
      const { parent: _old, ...rest } = layer;
      return replaceLayer(comp, parent === undefined ? rest : { ...rest, parent });
    },
  };
}

/** Set a keyframe on a transform property. A key at the same time is replaced; keys stay sorted. */
export function setKeyframe(layerId: Id, prop: TransformProp, key: Keyframe): Command {
  return {
    label: "Set keyframe",
    apply(comp) {
      const layer = find(comp, layerId);
      const track: Track = layer.transform[prop];
      const keys = track.keys.filter((k) => Math.abs(k.t - key.t) > 1e-9);
      keys.push(key);
      keys.sort((a, b) => a.t - b.t);
      return replaceLayer(comp, { ...layer, transform: { ...layer.transform, [prop]: { keys } } });
    },
  };
}

export function removeKeyframe(layerId: Id, prop: TransformProp, keyId: Id): Command {
  return {
    label: "Delete keyframe",
    apply(comp) {
      const layer = find(comp, layerId);
      const track = layer.transform[prop];
      const keys = track.keys.filter((k) => k.id !== keyId);
      if (keys.length === track.keys.length) return comp;
      return replaceLayer(comp, { ...layer, transform: { ...layer.transform, [prop]: { keys } } });
    },
  };
}

/** Change the composition length. Layers keep their own in/out points. */
export function setDuration(seconds: number): Command {
  return {
    label: "Set length",
    apply(comp) {
      if (!(seconds >= 0.1 && Number.isFinite(seconds))) throw new Error("Length must be at least 0.1 s");
      return seconds === comp.duration ? comp : { ...comp, duration: seconds };
    },
  };
}

/** Several edits as one undo step. They apply in order; if one throws, none take effect. */
export function sequence(label: string, commands: readonly Command[]): Command {
  return {
    label,
    apply: (comp) => commands.reduce((c, cmd) => cmd.apply(c), comp),
  };
}

/** Set a layer's visible range in seconds. */
export function setInOut(id: Id, inPoint: number, outPoint: number): Command {
  return {
    label: "Trim layer",
    apply(comp) {
      if (!(outPoint > inPoint)) throw new Error("outPoint must be after inPoint");
      return replaceLayer(comp, { ...find(comp, id), inPoint, outPoint });
    },
  };
}
