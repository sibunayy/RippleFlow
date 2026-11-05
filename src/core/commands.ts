import type { Command } from "./history";
import type { BlendMode, Composition, Effect, Id, Keyframe, Layer, ShapeContent, Track, Transform } from "./types";

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

/** Rename the project. Blank names are not allowed. */
export function renameComposition(name: string): Command {
  return {
    label: "Rename project",
    apply(comp) {
      const n = name.trim().slice(0, 80);
      if (!n) throw new Error("A project needs a name");
      return n === comp.name ? comp : { ...comp, name: n };
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

/** Change a shape layer's fill, gradient or stroke. `edit` returns the new content (or the same object for no change). */
export function editShape(id: Id, label: string, edit: (shape: ShapeContent) => ShapeContent): Command {
  return {
    label,
    apply(comp) {
      const layer = find(comp, id);
      if (!layer.shape) throw new Error(`Layer ${id} is not a shape`);
      const next = edit(layer.shape);
      return next === layer.shape ? comp : replaceLayer(comp, { ...layer, shape: next });
    },
  };
}

/** How the layer combines with what is behind it. */
export function setBlend(id: Id, blend: BlendMode): Command {
  return {
    label: "Blend mode",
    apply(comp) {
      const layer = find(comp, id);
      if ((layer.blend ?? "normal") === blend) return comp;
      const { blend: _drop, ...rest } = layer;
      return replaceLayer(comp, blend === "normal" ? rest : { ...rest, blend });
    },
  };
}

/** Append an effect to the layer's stack. */
export function addEffect(layerId: Id, effect: Effect): Command {
  return {
    label: "Add effect",
    apply(comp) {
      const layer = find(comp, layerId);
      if ((layer.effects ?? []).some((e) => e.id === effect.id)) throw new Error(`Effect ${effect.id} already exists`);
      return replaceLayer(comp, { ...layer, effects: [...(layer.effects ?? []), effect] });
    },
  };
}

export function removeEffect(layerId: Id, effectId: Id): Command {
  return {
    label: "Remove effect",
    apply(comp) {
      const layer = find(comp, layerId);
      const effects = (layer.effects ?? []).filter((e) => e.id !== effectId);
      if (effects.length === (layer.effects ?? []).length) throw new Error(`No effect ${effectId}`);
      const { effects: _drop, ...rest } = layer;
      return replaceLayer(comp, effects.length ? { ...rest, effects } : rest);
    },
  };
}

/** Move an effect within the stack (earlier effects are applied first). */
export function moveEffect(layerId: Id, effectId: Id, toIndex: number): Command {
  return {
    label: "Reorder effects",
    apply(comp) {
      const layer = find(comp, layerId);
      const list = [...(layer.effects ?? [])];
      const from = list.findIndex((e) => e.id === effectId);
      if (from < 0) throw new Error(`No effect ${effectId}`);
      const to = Math.min(Math.max(toIndex, 0), list.length - 1);
      if (to === from) return comp;
      const [e] = list.splice(from, 1);
      list.splice(to, 0, e!);
      return replaceLayer(comp, { ...layer, effects: list });
    },
  };
}

/** Change one effect (on/off, colour, values). `edit` returns the new effect, or the same object for no change. */
export function patchEffect(layerId: Id, effectId: Id, label: string, edit: (e: Effect) => Effect): Command {
  return {
    label,
    apply(comp) {
      const layer = find(comp, layerId);
      const list = layer.effects ?? [];
      const i = list.findIndex((e) => e.id === effectId);
      if (i < 0) throw new Error(`No effect ${effectId}`);
      const next = edit(list[i]!);
      return next === list[i] ? comp : replaceLayer(comp, { ...layer, effects: list.map((e, k) => (k === i ? next : e)) });
    },
  };
}
