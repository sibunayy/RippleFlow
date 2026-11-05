import { For, Index, Show } from "solid-js";
import { setBlend } from "../core/commands";
import type { Command } from "../core/history";
import { BLEND_MODES, type BlendMode, type Layer, type Rgba } from "../core/types";
import type { EditorController } from "../editor/controller";
import { hexToRgba, rgbToHex, withAlpha } from "../editor/color";
import {
  addStopAfter,
  fillColorOf,
  fillModeOf,
  patchStroke,
  removeStop,
  setFillColor,
  setFillMode,
  setGradientAngle,
  setStopColor,
  setStopOffset,
  setStrokeEnabled,
  type FillMode,
} from "../editor/styleEdit";
import { Compositing } from "./Compositing";
import { Effects } from "./Effects";
import { setTrim, trimValue } from "../editor/trimEdit";
import { ScrubField } from "./ScrubField";
import { TextPanel } from "./TextPanel";

const FILL_MODES: { id: FillMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "solid", label: "Solid" },
  { id: "linear", label: "Linear" },
  { id: "radial", label: "Radial" },
];
const BLEND_LABEL: Record<BlendMode, string> = { normal: "Normal", multiply: "Multiply", screen: "Screen", add: "Add" };
const JOINS = ["miter", "round", "bevel"] as const;
const CAPS = ["butt", "round", "square"] as const;

/** Colour swatch: native picker (works with Pencil), live preview while open, one undo step on close. */
function Swatch(p: { label: string; color: () => Rgba; preview: (c: Rgba) => void; commit: (c: Rgba) => void }) {
  return (
    <label class="swatch">
      <span class="scrub-label">{p.label}</span>
      <input
        type="color"
        aria-label={p.label}
        value={rgbToHex(p.color())}
        onInput={(e) => {
          const c = hexToRgba(e.currentTarget.value, p.color()[3]);
          if (c) p.preview(c);
        }}
        onChange={(e) => {
          const c = hexToRgba(e.currentTarget.value, p.color()[3]);
          if (c) p.commit(c);
        }}
      />
    </label>
  );
}

function Seg<T extends string>(p: { label: string; value: () => T; options: readonly { id: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div class="seg" role="group" aria-label={p.label}>
      <span class="scrub-label">{p.label}</span>
      <div class="seg-row">
        <For each={p.options}>
          {(o) => (
            <button classList={{ on: p.value() === o.id }} aria-pressed={p.value() === o.id} onClick={() => p.onPick(o.id)}>
              {o.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

/** Blend mode for any layer; fill, gradient and stroke for shape layers. */
export function Style(props: { ctrl: EditorController; tick: () => number; notify: (msg: string) => void; open: () => boolean }) {
  const ctrl = props.ctrl;
  const layer = (): Layer | undefined => (props.tick(), ctrl.document.layers.find((l) => l.id === ctrl.selection));
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
      /* an invalid intermediate value is simply not shown */
    }
  };

  return (
    <Show when={props.open() ? layer() : undefined}>
      {(l) => {
        const id = () => l().id;
        const shape = () => l().shape;
        return (
          <aside class="style" aria-label="Style">
            <h3>Style · {l().name}</h3>
            <div class="style-body">
              <Seg
                label="Blend"
                value={() => l().blend ?? "normal"}
                options={BLEND_MODES.map((m) => ({ id: m, label: BLEND_LABEL[m] }))}
                onPick={(m) => run(setBlend(id(), m))}
              />
              <Show when={shape()}>
                {(s) => (
                  <>
                    <div class="style-group">
                      <Seg label="Fill" value={() => fillModeOf(s())} options={FILL_MODES} onPick={(m) => run(setFillMode(id(), m))} />
                      <Show when={fillModeOf(s()) === "solid"}>
                        <Swatch
                          label="Colour"
                          color={() => fillColorOf(s())}
                          preview={(c) => preview(setFillColor(id(), c))}
                          commit={(c) => run(setFillColor(id(), c))}
                        />
                        <ScrubField
                          label="Alpha %"
                          value={() => fillColorOf(s())[3] * 100}
                          perPx={0.5}
                          min={0}
                          max={100}
                          onPreview={(v) => preview(setFillColor(id(), withAlpha(fillColorOf(s()), v / 100)))}
                          onCommit={(v) => run(setFillColor(id(), withAlpha(fillColorOf(s()), v / 100)))}
                        />
                      </Show>
                      <Show when={s().gradient}>
                        {(g) => (
                          <>
                            <Show when={g().kind === "linear"}>
                              <ScrubField
                                label="Angle °"
                                value={() => g().angle}
                                perPx={1}
                                onPreview={(v) => preview(setGradientAngle(id(), v))}
                                onCommit={(v) => run(setGradientAngle(id(), v))}
                              />
                            </Show>
                            <div class="stops">
                              <Index each={g().stops}>
                                {(st, i) => (
                                  <div class="stop">
                                    <Swatch
                                      label={`Colour ${i + 1}`}
                                      color={() => st().color}
                                      preview={(c) => preview(setStopColor(id(), i, c))}
                                      commit={(c) => run(setStopColor(id(), i, c))}
                                    />
                                    <ScrubField
                                      label={`Alpha ${i + 1} %`}
                                      value={() => st().color[3] * 100}
                                      perPx={0.5}
                                      min={0}
                                      max={100}
                                      onPreview={(v) => preview(setStopColor(id(), i, withAlpha(st().color, v / 100)))}
                                      onCommit={(v) => run(setStopColor(id(), i, withAlpha(st().color, v / 100)))}
                                    />
                                    <ScrubField
                                      label={`Position ${i + 1} %`}
                                      value={() => st().offset * 100}
                                      perPx={0.5}
                                      min={0}
                                      max={100}
                                      onPreview={(v) => preview(setStopOffset(id(), i, v / 100))}
                                      onCommit={(v) => run(setStopOffset(id(), i, v / 100))}
                                    />
                                    <button class="mini" aria-label={`Add colour after ${i + 1}`} onClick={() => run(addStopAfter(id(), i))}>+</button>
                                    <button class="mini" aria-label={`Remove colour ${i + 1}`} disabled={g().stops.length <= 2} onClick={() => run(removeStop(id(), i))}>×</button>
                                  </div>
                                )}
                              </Index>
                            </div>
                          </>
                        )}
                      </Show>
                    </div>
                    <div class="style-group">
                      <Seg
                        label="Stroke"
                        value={() => (s().stroke ? "on" : "off")}
                        options={[{ id: "off", label: "None" }, { id: "on", label: "Stroke" }]}
                        onPick={(v) => run(setStrokeEnabled(id(), v === "on"))}
                      />
                      <Show when={s().stroke}>
                        {(st) => (
                          <>
                            <Swatch
                              label="Stroke colour"
                              color={() => st().color}
                              preview={(c) => preview(patchStroke(id(), "Stroke colour", { color: c }))}
                              commit={(c) => run(patchStroke(id(), "Stroke colour", { color: c }))}
                            />
                            <ScrubField
                              label="Stroke alpha %"
                              value={() => st().color[3] * 100}
                              perPx={0.5}
                              min={0}
                              max={100}
                              onPreview={(v) => preview(patchStroke(id(), "Stroke alpha", { color: withAlpha(st().color, v / 100) }))}
                              onCommit={(v) => run(patchStroke(id(), "Stroke alpha", { color: withAlpha(st().color, v / 100) }))}
                            />
                            <ScrubField
                              label="Width"
                              value={() => st().width}
                              perPx={0.25}
                              min={0.5}
                              max={400}
                              onPreview={(v) => preview(patchStroke(id(), "Stroke width", { width: v }))}
                              onCommit={(v) => run(patchStroke(id(), "Stroke width", { width: v }))}
                            />
                            <Seg label="Join" value={() => st().join ?? "miter"} options={JOINS.map((j) => ({ id: j, label: j }))} onPick={(j) => run(patchStroke(id(), "Stroke join", { join: j }))} />
                            <Seg label="Cap" value={() => st().cap ?? "butt"} options={CAPS.map((c) => ({ id: c, label: c }))} onPick={(c) => run(patchStroke(id(), "Stroke cap", { cap: c }))} />
                            <For each={["start", "end"] as const}>
                              {(which) => (
                                <ScrubField
                                  label={which === "start" ? "Trim start %" : "Trim end %"}
                                  value={() => (props.tick(), trimValue(s(), which, ctrl.time) * 100)}
                                  perPx={0.4}
                                  min={0}
                                  max={100}
                                  onPreview={(v) => preview(setTrim(id(), which, v / 100, ctrl.time, ctrl.autoKey))}
                                  onCommit={(v) => run(setTrim(id(), which, v / 100, ctrl.time, ctrl.autoKey))}
                                />
                              )}
                            </For>
                          </>
                        )}
                      </Show>
                    </div>
                  </>
                )}
              </Show>
              <TextPanel ctrl={ctrl} tick={props.tick} layer={l} notify={props.notify} />
              <Compositing ctrl={ctrl} tick={props.tick} layer={l} notify={props.notify} />
              <Effects ctrl={ctrl} tick={props.tick} layer={l} notify={props.notify} />
            </div>
          </aside>
        );
      }}
    </Show>
  );
}
