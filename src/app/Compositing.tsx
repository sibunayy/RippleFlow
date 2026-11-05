import { For, Show } from "solid-js";
import { addMask, removeMask, sequence, setHidden, setMatte } from "../core/commands";
import type { Command } from "../core/history";
import type { Layer, MatteMode } from "../core/types";
import type { EditorController } from "../editor/controller";
import { maskPresetPath, newMask, setMaskFeather, setMaskInverted, setMaskMode, setMaskOpacity } from "../editor/maskEdit";
import { ScrubField } from "./ScrubField";

const MATTE_MODES: { id: MatteMode; label: string }[] = [
  { id: "alpha", label: "Alpha" },
  { id: "alphaInverted", label: "Alpha ⁻¹" },
  { id: "luma", label: "Luma" },
  { id: "lumaInverted", label: "Luma ⁻¹" },
];

/** Visibility, track matte and vector masks for the selected layer. */
export function Compositing(props: { ctrl: EditorController; tick: () => number; layer: () => Layer; notify: (m: string) => void }) {
  const { ctrl } = props;
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
  const others = () => ctrl.document.layers.filter((l) => l.id !== props.layer().id);
  const addPreset = (kind: "rect" | "ellipse") => {
    const b = ctrl.geometryOf(props.layer().id)?.bounds;
    if (!b) return props.notify("This layer has nothing to mask yet.");
    run(addMask(props.layer().id, newMask(`mask${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`, maskPresetPath(kind, b))));
  };

  return (
    <div class="style-group fx">
      <div class="fx-head">
        <span class="scrub-label">Compositing</span>
        <button class="mini wide" aria-pressed={props.layer().hidden === true} onClick={() => run(setHidden(props.layer().id, props.layer().hidden !== true))}>
          {props.layer().hidden ? "Hidden" : "Visible"}
        </button>
      </div>

      <label class="field-sel">
        <span class="scrub-label">Track matte (this layer shows through…)</span>
        <select
          aria-label="Matte layer"
          value={props.layer().matte?.source ?? ""}
          onChange={(e) => {
            const v = e.currentTarget.value;
            const set = setMatte(props.layer().id, v ? { source: v, mode: props.layer().matte?.mode ?? "alpha" } : undefined);
            // The matte layer is normally not drawn itself.
            run(v ? sequence("Set track matte", [set, setHidden(v, true)]) : set);
          }}
        >
          <option value="">None</option>
          <For each={others()}>{(l) => <option value={l.id}>{l.name}</option>}</For>
        </select>
      </label>
      <Show when={props.layer().matte}>
        {(m) => (
          <div class="seg" role="group" aria-label="Matte mode">
            <div class="seg-row">
              <For each={MATTE_MODES}>
                {(o) => (
                  <button classList={{ on: m().mode === o.id }} aria-pressed={m().mode === o.id} onClick={() => run(setMatte(props.layer().id, { source: m().source, mode: o.id }))}>
                    {o.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      <div class="fx-head">
        <span class="scrub-label">Masks</span>
        <span class="fx-btns">
          <button class="mini wide" onClick={() => addPreset("rect")}>+ Rect</button>
          <button class="mini wide" onClick={() => addPreset("ellipse")}>+ Ellipse</button>
        </span>
      </div>
      <For each={props.layer().masks ?? []}>
        {(mk, i) => {
          const lid = () => props.layer().id;
          const editing = () => (props.tick(), ctrl.pointEdit && ctrl.pointMask === mk.id);
          return (
            <div class="fx-card">
              <div class="fx-title">
                <strong>Mask {i() + 1}</strong>
                <span class="fx-btns">
                  <button class="mini" aria-pressed={editing()} aria-label={`Edit points of mask ${i() + 1}`} onClick={() => ctrl.setPointEdit(!editing(), editing() ? null : mk.id)}>
                    {editing() ? "Done" : "Points"}
                  </button>
                  <button class="mini" aria-label={`Invert mask ${i() + 1}`} aria-pressed={mk.inverted === true} onClick={() => run(setMaskInverted(lid(), mk.id, mk.inverted !== true))}>
                    ⇄
                  </button>
                  <button
                    class="mini"
                    aria-label={`Remove mask ${i() + 1}`}
                    onClick={() => {
                      if (editing()) ctrl.setPointEdit(false);
                      run(removeMask(lid(), mk.id));
                    }}
                  >
                    ×
                  </button>
                </span>
              </div>
              <div class="seg" role="group" aria-label={`Mask ${i() + 1} mode`}>
                <div class="seg-row">
                  <For each={["add", "subtract", "intersect"] as const}>
                    {(mode) => (
                      <button classList={{ on: mk.mode === mode }} aria-pressed={mk.mode === mode} onClick={() => run(setMaskMode(lid(), mk.id, mode))}>
                        {mode}
                      </button>
                    )}
                  </For>
                </div>
              </div>
              <div class="fx-params">
                <ScrubField
                  label={`Mask ${i() + 1} feather`}
                  value={() => (props.tick(), mk.feather)}
                  perPx={0.5}
                  min={0}
                  max={300}
                  onPreview={(v) => preview(setMaskFeather(lid(), mk.id, v))}
                  onCommit={(v) => run(setMaskFeather(lid(), mk.id, v))}
                />
                <ScrubField
                  label={`Mask ${i() + 1} opacity %`}
                  value={() => (props.tick(), mk.opacity * 100)}
                  perPx={0.5}
                  min={0}
                  max={100}
                  onPreview={(v) => preview(setMaskOpacity(lid(), mk.id, v / 100))}
                  onCommit={(v) => run(setMaskOpacity(lid(), mk.id, v / 100))}
                />
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
