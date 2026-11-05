import { editLayer } from "../core/commands";
import type { Command } from "../core/history";
import { DEFAULT_ANIMATOR } from "../core/text";
import type { Layer, TextAnimator, TextContent } from "../core/types";
import { layoutText } from "./glyphs";

/** Change a text layer's words or look; the stored outline is rebuilt to match. */
export function editText(id: string, label: string, patch: (t: TextContent) => TextContent): Command {
  return editLayer(id, label, (layer) => {
    if (!layer.text || !layer.shape) throw new Error(`Layer ${id} is not a text layer`);
    const next = patch(layer.text);
    if (next === layer.text) return layer;
    return { ...layer, text: next, shape: { ...layer.shape, path: layoutText(next).path } };
  });
}

/** Patch the animator (null removes it, a patch on a layer with none starts from the defaults). */
export function editAnimator(id: string, label: string, patch: (a: TextAnimator) => TextAnimator): Command {
  return editText(id, label, (t) => ({ ...t, animator: patch(t.animator ?? DEFAULT_ANIMATOR) }));
}

export const removeAnimator = (id: string): Command =>
  editText(id, "Remove text animator", (t) => {
    if (!t.animator) return t;
    const { animator: _gone, ...rest } = t;
    return rest;
  });

export const setText = (id: string, text: string): Command => editText(id, "Edit text", (t) => (t.text === text ? t : { ...t, text }));

/** True for layers made by the Text tool. */
export const isTextLayer = (l: Layer | undefined): boolean => !!l?.text;
