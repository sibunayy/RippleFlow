import { For, Show } from "solid-js";
import type { EditorController } from "../editor/controller";
import { propValue, setPropValue, type EditableProp } from "../editor/transformEdit";

interface Field {
  prop: EditableProp;
  label: string;
  /** Display value = stored * mul. */
  mul: number;
  step: number;
}

const FIELDS: Field[] = [
  { prop: "x", label: "X", mul: 1, step: 1 },
  { prop: "y", label: "Y", mul: 1, step: 1 },
  { prop: "scaleX", label: "Scale W %", mul: 100, step: 1 },
  { prop: "scaleY", label: "Scale H %", mul: 100, step: 1 },
  { prop: "rotation", label: "Rotate °", mul: 1, step: 1 },
  { prop: "opacity", label: "Opacity %", mul: 100, step: 1 },
];

/** Numeric transform fields for the selected layer, evaluated at the playhead. */
export function Props(props: { ctrl: EditorController; tick: () => number }) {
  const layer = () => (props.tick(), props.ctrl.document.layers.find((l) => l.id === props.ctrl.selection));
  return (
    <Show when={layer()}>
      {(l) => (
        <div class="props">
          <strong class="props-name">{l().name}</strong>
          <For each={FIELDS}>
            {(f) => (
              <label>
                {f.label}
                <input
                  type="number"
                  inputmode="decimal"
                  step={f.step}
                  value={+((props.tick(), propValue(l(), f.prop, props.ctrl.time)) * f.mul).toFixed(2)}
                  onChange={(e) => {
                    const v = e.currentTarget.valueAsNumber / f.mul;
                    props.ctrl.execute(setPropValue(l().id, f.prop, v, props.ctrl.time, props.ctrl.autoKey));
                    // Re-sync the box if the command rejected the value.
                    e.currentTarget.value = String(+(propValue(props.ctrl.document.layers.find((x) => x.id === l().id)!, f.prop, props.ctrl.time) * f.mul).toFixed(2));
                  }}
                />
                <Show when={f.prop === "opacity"}>
                  {/* A slider is hard to get wrong (the number box is in percent: 0.5 means 0.5%). Commits on release, one undo step. */}
                  <input
                    type="range"
                    class="slider"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round((props.tick(), propValue(l(), "opacity", props.ctrl.time)) * 100)}
                    onChange={(e) => props.ctrl.execute(setPropValue(l().id, "opacity", e.currentTarget.valueAsNumber / 100, props.ctrl.time, props.ctrl.autoKey))}
                  />
                </Show>
              </label>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
