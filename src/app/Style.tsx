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
import { setTrim, trimValue } from "../editor/trimEdit";
import { ScrubField } from "./ScrubField";
import { TextPanel } from "./TextPanel";

const FILL_MODES: { id: FillMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "solid", label: "Solid" },
  { id: "linear", label: "Linear gradient" },
  { id: "radial", label: "Radial gradient" },
];
const BLEND_LABEL: Record<BlendMode, string> = { normal: "Normal", multiply: "Multiply", screen: "Screen", add: "Add" };
const JOINS = ["miter", "round", "bevel"] as const;
const CAPS = ["butt", "round", "square"] as const;

/** Colour swatch: native picker (works with Pencil), live preview while open, one undo step on close. */
export function Swatch(p: { label: string; color: () => Rgba; preview: (c: Rgba) => void; commit: (c: Rgba) => void }) {
  return (
    <input
      class="swatch"
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
  );
}

/** The colour as six hex digits, typed. */
function HexField(p: { label: string; color: () => Rgba; commit: (c: Rgba) => void }) {
  return (
    <label class="field-in pre">
      <span class="scrub-pre" aria-hidden="true">#</span>
      <input
        type="text"
        inputmode="text"
        autocapitalize="characters"
        spellcheck={false}
        aria-label={p.label}
        value={rgbToHex(p.color()).slice(1).toUpperCase()}
        onChange={(e) => {
          const c = hexToRgba(`#${e.currentTarget.value.replace(/^#/, "").trim()}`, p.color()[3]);
          if (c) p.commit(c);
          e.currentTarget.value = rgbToHex(p.color()).slice(1).toUpperCase();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function Select<T extends string>(p: { label: string; value: () => T; options: readonly { id: T; label: string }[]; onPick: (v: T) => void; class?: string }) {
  return (
    <select class={`sel ${p.class ?? ""}`} aria-label={p.label} onChange={(e) => p.onPick(e.currentTarget.value as T)}>
      <For each={p.options}>{(o) => <option value={o.id} selected={p.value() === o.id}>{o.label}</option>}</For>
    </select>
  );
}

/** On/off switch from the design (mint when on). */
export function Switch(p: { label: string; on: () => boolean; set: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" class="switch" role="switch" aria-checked={p.on()} aria-label={p.label} disabled={p.disabled} onClick={() => p.set(!p.on())}>
      <span />
    </button>
  );
}

/** Style tab: text, fill, blend, stroke and trim for the selected layer. */
export function StyleTab(props: { ctrl: EditorController; tick: () => number; notify: (msg: string) => void; layer: () => Layer }) {
  const ctrl = props.ctrl;
  const l = props.layer;
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
  const id = () => l().id;
  const shape = () => l().shape;

  return (
    <div class="tab-body">
      <TextPanel ctrl={ctrl} tick={props.tick} layer={l} part="text" notify={props.notify} />
      <div class="pair">
        <Show when={shape()}>
          {(s) => (
            <div>
              <span class="lab">Fill</span>
              <Select label="Fill type" value={() => fillModeOf(s())} options={FILL_MODES} onPick={(m) => run(setFillMode(id(), m))} />
            </div>
          )}
        </Show>
        <div>
          <span class="lab">Blend</span>
          <Select label="Blend mode" value={() => l().blend ?? "normal"} options={BLEND_MODES.map((m) => ({ id: m, label: BLEND_LABEL[m] }))} onPick={(m) => run(setBlend(id(), m))} />
        </div>
      </div>
      <Show when={shape()}>
        {(s) => (
          <>
            <Show when={fillModeOf(s()) === "solid"}>
              <div class="color-row">
                <Swatch label="Fill colour" color={() => fillColorOf(s())} preview={(c) => preview(setFillColor(id(), c))} commit={(c) => run(setFillColor(id(), c))} />
                <HexField label="Fill colour hex" color={() => fillColorOf(s())} commit={(c) => run(setFillColor(id(), c))} />
                <ScrubField
                  inline
                  label="Fill alpha %"
                  suffix="%"
                  decimals={0}
                  value={() => fillColorOf(s())[3] * 100}
                  perPx={0.5}
                  min={0}
                  max={100}
                  onPreview={(v) => preview(setFillColor(id(), withAlpha(fillColorOf(s()), v / 100)))}
                  onCommit={(v) => run(setFillColor(id(), withAlpha(fillColorOf(s()), v / 100)))}
                />
              </div>
            </Show>
            <Show when={s().gradient}>
              {(g) => (
                <div class="group">
                  <Show when={g().kind === "linear"}>
                    <ScrubField label="Angle" suffix="°" inline prefix="∠" value={() => g().angle} perPx={1} onPreview={(v) => preview(setGradientAngle(id(), v))} onCommit={(v) => run(setGradientAngle(id(), v))} />
                  </Show>
                  <Index each={g().stops}>
                    {(st, i) => (
                      <div class="stop-row">
                        <Swatch label={`Colour ${i + 1}`} color={() => st().color} preview={(c) => preview(setStopColor(id(), i, c))} commit={(c) => run(setStopColor(id(), i, c))} />
                        <ScrubField
                          inline
                          label={`Alpha ${i + 1} %`}
                          suffix="%"
                          decimals={0}
                          value={() => st().color[3] * 100}
                          perPx={0.5}
                          min={0}
                          max={100}
                          onPreview={(v) => preview(setStopColor(id(), i, withAlpha(st().color, v / 100)))}
                          onCommit={(v) => run(setStopColor(id(), i, withAlpha(st().color, v / 100)))}
                        />
                        <ScrubField
                          inline
                          prefix="at"
                          label={`Position ${i + 1} %`}
                          suffix="%"
                          decimals={0}
                          value={() => st().offset * 100}
                          perPx={0.5}
                          min={0}
                          max={100}
                          onPreview={(v) => preview(setStopOffset(id(), i, v / 100))}
                          onCommit={(v) => run(setStopOffset(id(), i, v / 100))}
                        />
                        <button class="icon-btn" aria-label={`Add colour after ${i + 1}`} onClick={() => run(addStopAfter(id(), i))}>+</button>
                        <button class="icon-btn" aria-label={`Remove colour ${i + 1}`} disabled={g().stops.length <= 2} onClick={() => run(removeStop(id(), i))}>×</button>
                      </div>
                    )}
                  </Index>
                </div>
              )}
            </Show>
            <div class="group">
              <div class="lab-row">
                <span class="lab">Stroke</span>
                <Switch label="Stroke" on={() => !!s().stroke} set={(v) => run(setStrokeEnabled(id(), v))} />
              </div>
              <Show when={s().stroke}>
                {(st) => (
                  <>
                    <div class="color-row">
                      <Swatch
                        label="Stroke colour"
                        color={() => st().color}
                        preview={(c) => preview(patchStroke(id(), "Stroke colour", { color: c }))}
                        commit={(c) => run(patchStroke(id(), "Stroke colour", { color: c }))}
                      />
                      <HexField label="Stroke colour hex" color={() => st().color} commit={(c) => run(patchStroke(id(), "Stroke colour", { color: c }))} />
                      <ScrubField
                        inline
                        prefix="px"
                        label="Width"
                        value={() => st().width}
                        perPx={0.25}
                        min={0.5}
                        max={400}
                        decimals={1}
                        onPreview={(v) => preview(patchStroke(id(), "Stroke width", { width: v }))}
                        onCommit={(v) => run(patchStroke(id(), "Stroke width", { width: v }))}
                      />
                    </div>
                    <div class="pair">
                      <Select
                        label="Line join"
                        value={() => st().join ?? "miter"}
                        options={JOINS.map((j) => ({ id: j, label: `Join: ${j}` }))}
                        onPick={(j) => run(patchStroke(id(), "Stroke join", { join: j }))}
                      />
                      <Select
                        label="Line cap"
                        value={() => st().cap ?? "butt"}
                        options={CAPS.map((c) => ({ id: c, label: `Cap: ${c}` }))}
                        onPick={(c) => run(patchStroke(id(), "Stroke cap", { cap: c }))}
                      />
                    </div>
                    <div class="pair">
                      <ScrubField
                        inline
                        label="Stroke alpha %"
                        prefix="α"
                        suffix="%"
                        decimals={0}
                        value={() => st().color[3] * 100}
                        perPx={0.5}
                        min={0}
                        max={100}
                        onPreview={(v) => preview(patchStroke(id(), "Stroke alpha", { color: withAlpha(st().color, v / 100) }))}
                        onCommit={(v) => run(patchStroke(id(), "Stroke alpha", { color: withAlpha(st().color, v / 100) }))}
                      />
                    </div>
                    <span class="lab">Trim path</span>
                    <div class="pair">
                      <For each={["start", "end"] as const}>
                        {(which) => (
                          <ScrubField
                            inline
                            prefix={which === "start" ? "Start" : "End"}
                            suffix="%"
                            decimals={1}
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
                    </div>
                  </>
                )}
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
