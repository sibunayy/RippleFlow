import { createSignal, For, Match, Show, Switch as Pick, type Accessor } from "solid-js";
import { sequence, setParent } from "../core/commands";
import type { Command } from "../core/history";
import { applyPreset, applyPresetToChildren, clearPreset, detectPreset, PRESETS } from "../core/presets";
import type { Layer } from "../core/types";
import type { EditorController } from "../editor/controller";
import { ALIGN_MODES, type AlignMode } from "../editor/align";
import { keyStateAt, propValue, setPropValue, toggleKeyAt, type EditableProp } from "../editor/transformEdit";
import { Compositing } from "./Compositing";
import { Effects } from "./Effects";
import { Icon } from "./icons";
import { ScrubField } from "./ScrubField";
import { StyleTab, Switch } from "./Style";
import { TextPanel } from "./TextPanel";

export type InspectorTab = "transform" | "style" | "effects" | "motion";
const TABS: { id: InspectorTab; label: string }[] = [
  { id: "transform", label: "Transform" },
  { id: "style", label: "Style" },
  { id: "effects", label: "Effects" },
  { id: "motion", label: "Motion" },
];

/** What kind of thing a layer is, in words, for the inspector subtitle. */
export function layerKind(l: Layer, layers: readonly Layer[]): string {
  if (l.text) return "Text";
  if (l.image) return "Image";
  if (l.video) return "Video clip";
  if (!l.shape) return layers.some((o) => o.parent === l.id) ? "Group" : "Null";
  const first = l.name.split(" ")[0] ?? "";
  const known: Record<string, string> = { Rect: "Rectangle", Ellipse: "Ellipse", Star: "Star", Rounded: "Rounded rectangle", Triangle: "Triangle", Hexagon: "Hexagon", Plus: "Plus", Arrow: "Arrow", Heart: "Heart", Line: "Line" };
  return known[first] ?? "Shape";
}

export function Inspector(props: {
  ctrl: EditorController;
  tick: () => number;
  notify: (m: string) => void;
  tab: Accessor<InspectorTab>;
  setTab: (t: InspectorTab) => void;
  collapsed: Accessor<boolean>;
  onToggle: () => void;
}) {
  const ctrl = props.ctrl;
  const layer = () => (props.tick(), ctrl.document.layers.find((l) => l.id === ctrl.selection));
  return (
    <aside class="inspector" classList={{ collapsed: props.collapsed() }} aria-label="Inspector">
      <div class="insp-head">
        <span class="grabber" aria-hidden="true" />
        <div class="insp-title">
          <Show when={layer()} fallback={<><span class="insp-name">Nothing selected</span><span class="insp-kind">Tap a layer to edit it</span></>}>
            {(l) => (
              <>
                <span class="insp-name">{l().name}</span>
                <span class="insp-kind">{(props.tick(), layerKind(l(), ctrl.document.layers))}</span>
              </>
            )}
          </Show>
        </div>
        <div class="tabs" role="tablist" aria-label="Inspector">
          <For each={TABS}>
            {(t) => (
              <button type="button" role="tab" id={`tab-${t.id}`} aria-selected={props.tab() === t.id} aria-controls="insp-panel" onClick={() => props.setTab(t.id)}>
                {t.label}
              </button>
            )}
          </For>
        </div>
        <button type="button" class="icon-btn ghost insp-toggle" aria-label={props.collapsed() ? "Show inspector" : "Hide inspector"} aria-expanded={!props.collapsed()} onClick={props.onToggle}>
          <Icon name="panel" class="ico-landscape" />
          <Icon name="sheet" class="ico-portrait" />
        </button>
      </div>
      <div class="insp-body" id="insp-panel" role="tabpanel" aria-labelledby={`tab-${props.tab()}`}>
        <Show when={layer()} fallback={<p class="empty">Add a shape, text or media from the tool rail, or tap one on the canvas.</p>}>
          {(l) => (
            <Pick>
              <Match when={props.tab() === "transform"}>
                <TransformTab ctrl={ctrl} tick={props.tick} layer={l} />
              </Match>
              <Match when={props.tab() === "style"}>
                <StyleTab ctrl={ctrl} tick={props.tick} layer={l} notify={props.notify} />
              </Match>
              <Match when={props.tab() === "effects"}>
                <div class="tab-body">
                  <Effects ctrl={ctrl} tick={props.tick} layer={l} notify={props.notify} />
                  <Compositing ctrl={ctrl} tick={props.tick} layer={l} notify={props.notify} />
                </div>
              </Match>
              <Match when={props.tab() === "motion"}>
                <MotionTab ctrl={ctrl} tick={props.tick} layer={l} notify={props.notify} />
              </Match>
            </Pick>
          )}
        </Show>
      </div>
    </aside>
  );
}

interface Field {
  prop: EditableProp;
  label: string;
  prefix?: string;
  suffix?: string;
  mul: number;
  perPx: number;
  min?: number;
  max?: number;
  decimals?: number;
}

const ROWS: { label: string; fields: Field[] }[] = [
  { label: "Position", fields: [{ prop: "x", label: "Position X", prefix: "X", mul: 1, perPx: 2, decimals: 0 }, { prop: "y", label: "Position Y", prefix: "Y", mul: 1, perPx: 2, decimals: 0 }] },
  { label: "Scale", fields: [{ prop: "scaleX", label: "Scale width percent", prefix: "W", mul: 100, perPx: 0.5, decimals: 0 }, { prop: "scaleY", label: "Scale height percent", prefix: "H", mul: 100, perPx: 0.5, decimals: 0 }] },
  { label: "Rotation", fields: [{ prop: "rotation", label: "Rotation degrees", suffix: "°", mul: 1, perPx: 0.5, decimals: 1 }] },
  { label: "Opacity", fields: [{ prop: "opacity", label: "Opacity percent", suffix: "%", mul: 100, perPx: 0.5, min: 0, max: 100, decimals: 0 }] },
];

const ALIGN_WORDS: Record<AlignMode, string> = { left: "Left", centerX: "Centre horizontally", right: "Right", top: "Top", centerY: "Middle vertically", bottom: "Bottom" };

/** Position, scale, rotation and opacity at the playhead, each with a keyframe button; align to the composition. */
function TransformTab(props: { ctrl: EditorController; tick: () => number; layer: () => Layer }) {
  const ctrl = props.ctrl;
  const l = props.layer;
  return (
    <div class="tab-body">
      <For each={ROWS}>
        {(row) => {
          const state = () => {
            props.tick();
            const s = row.fields.map((f) => keyStateAt(l().transform[f.prop], ctrl.time));
            return s.includes("here") ? "here" : s.includes("animated") ? "animated" : "static";
          };
          const words = { here: "set", animated: "animated", static: "not animated" } as const;
          return (
            <div class="prop-row" classList={{ wide: row.fields.length === 1 }}>
              <span class="lab">{row.label}</span>
              <For each={row.fields}>
                {(f) => {
                  const cmd = (v: number) => setPropValue(l().id, f.prop, v / f.mul, ctrl.time, ctrl.autoKey);
                  return (
                    <ScrubField
                      inline
                      label={f.label}
                      prefix={f.prefix}
                      suffix={f.suffix}
                      decimals={f.decimals}
                      value={() => (props.tick(), propValue(l(), f.prop, ctrl.time) * f.mul)}
                      perPx={f.perPx}
                      min={f.min}
                      max={f.max}
                      onPreview={(v) => ctrl.setPreview(cmd(v))}
                      onCommit={(v) => {
                        ctrl.setPreview(null);
                        ctrl.execute(cmd(v));
                      }}
                    />
                  );
                }}
              </For>
              <button
                type="button"
                class="key-btn"
                classList={{ [state()]: true }}
                aria-label={`${row.label} keyframe at playhead, ${words[state()]}`}
                aria-pressed={state() === "here"}
                onClick={() => ctrl.execute(toggleKeyAt(l().id, row.fields.map((f) => f.prop), ctrl.time))}>
                <Icon name="diamond" size={20} stroke={2} fill={state() === "here" ? "currentColor" : "none"} />
              </button>
            </div>
          );
        }}
      </For>
      <div class="prop-row single">
        <span class="lab">Align</span>
        <select
          class="sel"
          aria-label="Align to composition"
          onChange={(e) => {
            const m = e.currentTarget.value as AlignMode | "";
            e.currentTarget.value = "";
            if (m) ctrl.alignSelected(m);
          }}>
          <option value="">Align to composition</option>
          <For each={ALIGN_MODES}>{(a) => <option value={a.mode}>{ALIGN_WORDS[a.mode]}</option>}</For>
        </select>
      </div>
    </div>
  );
}

/** Ready-made in/out motion, staggered children, parenting and the text animator. */
function MotionTab(props: { ctrl: EditorController; tick: () => number; layer: () => Layer; notify: (m: string) => void }) {
  const ctrl = props.ctrl;
  const l = props.layer;
  const [stagger, setStagger] = createSignal(0.08);
  const [staggerOn, setStaggerOn] = createSignal(true);
  const children = () => (props.tick(), ctrl.document.layers.filter((o) => o.parent === l().id));
  const toKids = () => staggerOn() && children().length > 0;
  const run = (cmd: Command) => {
    try {
      ctrl.execute(cmd);
    } catch (e) {
      props.notify(e instanceof Error ? e.message : String(e));
    }
  };
  const short = (label: string) => label.replace(/ (in|out|up|down)$/, "");
  const options = (kind: "in" | "out") => [{ id: "", label: "None" }, ...PRESETS.filter((p) => p.kind === kind).map((p) => ({ id: p.id, label: p.id === "slide-right" ? "Slide in" : short(p.label) }))];
  /** Shown value: what the layer (or, when animating children, its first child) carries now. */
  const current = (kind: "in" | "out") => {
    props.tick();
    const target = toKids() ? children()[0]! : l();
    return detectPreset(target, kind, ctrl.document.duration) ?? "";
  };
  const pick = (kind: "in" | "out", id: string) => {
    const d = ctrl.document.duration;
    const targets = toKids() ? children() : [l()];
    const clear = sequence("Clear", targets.map((t) => clearPreset(t.id, kind, d)));
    if (!id) return run(sequence(kind === "in" ? "Remove animate in" : "Remove animate out", [clear]));
    const label = PRESETS.find((p) => p.id === id)!.label;
    run(sequence(label, [clear, toKids() ? applyPresetToChildren(l().id, id, d, stagger()) : applyPreset(l().id, id, d)]));
  };
  return (
    <div class="tab-body">
      <div class="pair">
        <For each={["in", "out"] as const}>
          {(kind) => (
            <div>
              <span class="lab">{kind === "in" ? "Animate in" : "Animate out"}</span>
              <select class="sel" classList={{ out: kind === "out" }} aria-label={kind === "in" ? "Animate in preset" : "Animate out preset"} onChange={(e) => pick(kind, e.currentTarget.value)}>
                <For each={options(kind)}>{(o) => <option value={o.id} selected={current(kind) === o.id}>{o.label}</option>}</For>
              </select>
            </div>
          )}
        </For>
      </div>
      <div class="motion-row">
        <div class="stagger" classList={{ off: children().length === 0 }}>
          <span class="stagger-label">Stagger children</span>
          <Switch label="Stagger children" on={() => staggerOn() && children().length > 0} set={setStaggerOn} disabled={children().length === 0} />
          <ScrubField inline label="Stagger delay" suffix="s" decimals={2} value={stagger} perPx={0.01} min={0} max={2} onPreview={setStagger} onCommit={setStagger} />
        </div>
        <div class="parent-row">
          <span class="lab">Parent</span>
          <select class="sel" aria-label="Parent layer" onChange={(e) => run(setParent(l().id, e.currentTarget.value || undefined))}>
            <option value="" selected={!l().parent}>None</option>
            <For each={ctrl.document.layers.filter((o) => o.id !== l().id && !descendsFrom(ctrl.document.layers, o, l().id))}>
              {(o) => <option value={o.id} selected={l().parent === o.id}>{o.name}</option>}
            </For>
          </select>
        </div>
      </div>
      <Show when={children().length === 0}>
        <p class="hint">Stagger applies the in and out motion to each child layer in turn. Parent layers to this one to use it.</p>
      </Show>
      <TextPanel ctrl={ctrl} tick={props.tick} layer={l} part="animator" notify={props.notify} />
    </div>
  );
}

/** True when `layer` is `ancestor` or sits below it in the parent chain (so it can't become its parent). */
function descendsFrom(layers: readonly Layer[], layer: Layer, ancestor: string): boolean {
  const byId = new Map(layers.map((x) => [x.id, x]));
  for (let cur: Layer | undefined = layer, n = 0; cur && n <= layers.length; n++, cur = cur.parent ? byId.get(cur.parent) : undefined) {
    if (cur.id === ancestor) return true;
  }
  return false;
}
