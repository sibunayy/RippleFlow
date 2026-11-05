import { For, Show } from "solid-js";
import type { EditorController } from "../editor/controller";
import { propValue, setPropValue, type EditableProp } from "../editor/transformEdit";
import { ScrubField } from "./ScrubField";

interface Field {
  prop: EditableProp;
  label: string;
  /** Display value = stored * mul. */
  mul: number;
  /** Display units per pixel dragged. */
  perPx: number;
  min?: number;
  max?: number;
}

const FIELDS: Field[] = [
  { prop: "x", label: "X", mul: 1, perPx: 2 },
  { prop: "y", label: "Y", mul: 1, perPx: 2 },
  { prop: "scaleX", label: "Scale W %", mul: 100, perPx: 0.5 },
  { prop: "scaleY", label: "Scale H %", mul: 100, perPx: 0.5 },
  { prop: "rotation", label: "Rotate °", mul: 1, perPx: 0.5 },
  { prop: "opacity", label: "Opacity %", mul: 100, perPx: 0.5, min: 0, max: 100 },
];

/** Numeric transform fields for the selected layer, evaluated at the playhead. Drag a number to scrub it, tap to type. */
export function Props(props: { ctrl: EditorController; tick: () => number }) {
  const layer = () => (props.tick(), props.ctrl.document.layers.find((l) => l.id === props.ctrl.selection));
  return (
    <Show when={layer()}>
      {(l) => (
        <div class="props">
          <strong class="props-name">{l().name}</strong>
          <For each={FIELDS}>
            {(f) => {
              const cmd = (v: number) => setPropValue(l().id, f.prop, v / f.mul, props.ctrl.time, props.ctrl.autoKey);
              return (
                <ScrubField
                  label={f.label}
                  value={() => (props.tick(), propValue(l(), f.prop, props.ctrl.time) * f.mul)}
                  perPx={f.perPx}
                  min={f.min}
                  max={f.max}
                  onPreview={(v) => props.ctrl.setPreview(cmd(v))}
                  onCommit={(v) => {
                    props.ctrl.setPreview(null);
                    props.ctrl.execute(cmd(v));
                  }}
                />
              );
            }}
          </For>
        </div>
      )}
    </Show>
  );
}
