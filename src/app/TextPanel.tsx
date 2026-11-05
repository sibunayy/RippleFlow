import { For, Show, createEffect } from "solid-js";
import type { Command } from "../core/history";
import { DEFAULT_ANIMATOR } from "../core/text";
import type { Bezier, Layer, TextAnimator, TextUnit } from "../core/types";
import type { EditorController } from "../editor/controller";
import { DEFAULT_FONT } from "../text/glyphs";
import { ensureFont, FONTS } from "../text/fonts";
import { editAnimator, editText, removeAnimator, setText } from "../text/textEdit";
import { ScrubField } from "./ScrubField";

const UNITS: { id: TextUnit; label: string }[] = [
  { id: "char", label: "Character" },
  { id: "word", label: "Word" },
  { id: "line", label: "Line" },
];
const EASES: { label: string; ease: Bezier }[] = [
  { label: "Smooth", ease: [0.2, 0.8, 0.2, 1] },
  { label: "Linear", ease: [0, 0, 1, 1] },
  { label: "Overshoot", ease: [0.34, 1.56, 0.64, 1] },
];
const ALIGNS = ["left", "center", "right"] as const;

/** Text content, look and per-character/word/line animator of the selected text layer. */
export function TextPanel(props: { ctrl: EditorController; tick: () => number; layer: () => Layer; notify: (m: string) => void }) {
  const { ctrl } = props;
  const id = () => props.layer().id;
  const t = () => props.layer().text!;
  const run = (cmd: Command) => {
    try {
      ctrl.setPreview(null);
      ctrl.execute(cmd);
    } catch (e) {
      props.notify(e instanceof Error ? e.message : String(e));
    }
  };
  const preview = (cmd: Command) => {
    try {
      ctrl.setPreview(cmd);
    } catch {
      /* not shown */
    }
  };
  // A reopened project's font loads on demand; edits wait for it (layout needs the font, drawing does not).
  createEffect(() => {
    const f = props.layer().text?.font;
    if (f) void ensureFont(f);
  });
  const pickFont = async (fid: string) => {
    if (!(await ensureFont(fid))) return props.notify("Could not load that font");
    run(editText(id(), "Text font", (x) => (fid === DEFAULT_FONT ? ((({ font: _f, ...rest }) => rest)(x) as typeof x) : { ...x, font: fid })));
  };
  const anim = () => t().animator;
  const patchA = (label: string, p: Partial<TextAnimator>) => editAnimator(id(), label, (a) => ({ ...a, ...p }));
  const patchFrom = (label: string, p: Partial<TextAnimator["from"]>) => editAnimator(id(), label, (a) => ({ ...a, from: { ...a.from, ...p } }));
  const num = (label: string, value: () => number, perPx: number, mk: (v: number) => Command, opts: { min?: number; max?: number } = {}) => (
    <ScrubField label={label} value={value} perPx={perPx} min={opts.min} max={opts.max} onPreview={(v) => preview(mk(v))} onCommit={(v) => run(mk(v))} />
  );

  return (
    <Show when={props.layer().text}>
      <div class="style-group text-panel">
        <span class="scrub-label">Text</span>
        <textarea
          class="text-input"
          rows="3"
          value={t().text}
          onInput={(e) => preview(setText(id(), e.currentTarget.value))}
          onChange={(e) => run(setText(id(), e.currentTarget.value))}
        />
        <label class="seg">
          <span class="scrub-label">Font</span>
          <select class="font-select" value={(props.tick(), t().font ?? DEFAULT_FONT)} onChange={(e) => void pickFont(e.currentTarget.value)}>
            <For each={FONTS}>{(f) => <option value={f.id} selected={(props.tick(), (t().font ?? DEFAULT_FONT) === f.id)}>{f.label}</option>}</For>
          </select>
        </label>
        {num("Size", () => (props.tick(), t().size), 1, (v) => editText(id(), "Text size", (x) => ({ ...x, size: Math.max(1, v) })), { min: 1, max: 1000 })}
        {num("Tracking", () => (props.tick(), t().tracking), 0.5, (v) => editText(id(), "Text tracking", (x) => ({ ...x, tracking: v })), { min: -100, max: 400 })}
        <div class="seg" role="group" aria-label="Align">
          <span class="scrub-label">Align</span>
          <div class="seg-row">
            <For each={ALIGNS}>
              {(a) => (
                <button classList={{ on: (props.tick(), t().align === a) }} onClick={() => run(editText(id(), "Text align", (x) => ({ ...x, align: a })))}>
                  {a}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="fx-head">
          <span class="scrub-label">Animator</span>
          <button class="mini wide" onClick={() => run(anim() ? removeAnimator(id()) : editAnimator(id(), "Add text animator", (a) => a))}>
            {(props.tick(), anim() ? "Remove" : "+ Add")}
          </button>
        </div>
        <Show when={(props.tick(), anim())}>
          <div class="seg" role="group" aria-label="Animate by">
            <span class="scrub-label">By</span>
            <div class="seg-row">
              <For each={UNITS}>
                {(u) => (
                  <button classList={{ on: (props.tick(), anim()?.unit === u.id) }} onClick={() => run(patchA("Animate by", { unit: u.id }))}>
                    {u.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          {num("Start s", () => (props.tick(), anim()?.start ?? 0), 0.01, (v) => patchA("Animator start", { start: v }))}
          {num("Stagger s", () => (props.tick(), anim()?.stagger ?? DEFAULT_ANIMATOR.stagger), 0.005, (v) => patchA("Animator stagger", { stagger: v }), { min: -2, max: 2 })}
          {num("Duration s", () => (props.tick(), anim()?.duration ?? 0), 0.01, (v) => patchA("Animator duration", { duration: Math.max(0, v) }), { min: 0, max: 20 })}
          <div class="seg" role="group" aria-label="Easing">
            <span class="scrub-label">Ease</span>
            <div class="seg-row">
              <For each={EASES}>
                {(e) => (
                  <button classList={{ on: (props.tick(), JSON.stringify(anim()?.ease) === JSON.stringify(e.ease)) }} onClick={() => run(patchA("Animator easing", { ease: e.ease }))}>
                    {e.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <span class="scrub-label">Each unit starts from</span>
          {num("Opacity %", () => (props.tick(), (anim()?.from.opacity ?? 0) * 100), 0.5, (v) => patchFrom("Animator opacity", { opacity: v / 100 }), { min: 0, max: 100 })}
          {num("Offset X", () => (props.tick(), anim()?.from.dx ?? 0), 1, (v) => patchFrom("Animator offset X", { dx: v }))}
          {num("Offset Y", () => (props.tick(), anim()?.from.dy ?? 0), 1, (v) => patchFrom("Animator offset Y", { dy: v }))}
          {num("Scale %", () => (props.tick(), (anim()?.from.scale ?? 1) * 100), 0.5, (v) => patchFrom("Animator scale", { scale: v / 100 }), { min: 0, max: 1000 })}
          {num("Rotate °", () => (props.tick(), anim()?.from.rotation ?? 0), 0.5, (v) => patchFrom("Animator rotation", { rotation: v }))}
        </Show>
      </div>
    </Show>
  );
}
