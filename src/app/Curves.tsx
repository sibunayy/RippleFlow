import { createSignal, For, Show } from "solid-js";
import { evalTrack } from "../core/evaluate";
import { EFFECT_BY_TYPE } from "../core/effects";
import type { Bezier, Layer } from "../core/types";
import type { EditorController } from "../editor/controller";
import { PRESETS, setEase } from "../editor/easingEdit";
import { layerTrackPaths, trackAt, type KeyColumn, type TrackPath } from "../editor/keyframeEdit";
import { Flag } from "./Timeline";

const NAMES: Record<string, string> = { x: "Position X", y: "Position Y", scaleX: "Scale W", scaleY: "Scale H", rotation: "Rotation", opacity: "Opacity", anchorX: "Anchor X", anchorY: "Anchor Y" };
const PERCENT = new Set(["scaleX", "scaleY", "opacity", "trim:start", "trim:end"]);
const RULER = 32;
const PAD = 18;

/** Human name of a keyframable track. */
export function trackName(layer: Layer, path: TrackPath): string {
  if (path.startsWith("fx:")) {
    const [, id, key] = path.split(":");
    const fx = layer.effects?.find((e) => e.id === id);
    const spec = fx ? EFFECT_BY_TYPE[fx.type] : undefined;
    return `${spec?.label ?? "Effect"} ${spec?.params.find((p) => p.key === key)?.label.toLowerCase() ?? key}`;
  }
  if (path === "trim:start") return "Trim start";
  if (path === "trim:end") return "Trim end";
  return NAMES[path] ?? path;
}

const defaultOf = (path: TrackPath): number => (path === "scaleX" || path === "scaleY" || path === "opacity" || path === "trim:end" ? 1 : 0);
const shown = (path: TrackPath, v: number): string => (PERCENT.has(path) ? `${Math.round(v * 100)}%` : path === "rotation" ? `${v.toFixed(1)}°` : `${Math.round(v * 10) / 10}`);

/** Animated tracks of a layer (two or more keys). */
const animatedPaths = (l: Layer): TrackPath[] => layerTrackPaths(l).filter((p) => (trackAt(l, p)?.keys.length ?? 0) > 1);

/**
 * The Curves view: one animated property's value over time. Tap a diamond to pick the segment that starts there;
 * drag its two coral handles to shape the easing (a bezier per segment, as in the Keys view).
 */
export function Curves(props: {
  ctrl: EditorController;
  tick: () => number;
  picked: () => KeyColumn | null;
  setPicked: (c: KeyColumn | null) => void;
  width: () => number;
  height: () => number;
  xOf: (t: number) => number;
  ticks: () => number[];
  rulerDown: (e: PointerEvent) => void;
  rulerMove: (e: PointerEvent) => void;
}) {
  const ctrl = props.ctrl;
  const [chosen, setChosen] = createSignal<TrackPath | null>(null);
  const [frozen, setFrozen] = createSignal<{ lo: number; hi: number } | null>(null);
  const [active, setActive] = createSignal<0 | 1 | null>(null);
  let svg!: SVGSVGElement;

  /** The selected layer as displayed (with a handle drag previewed). */
  const layer = () => (props.tick(), ctrl.displayed.layers.find((l) => l.id === ctrl.selection));
  const paths = () => {
    const l = layer();
    return l ? animatedPaths(l) : [];
  };
  const path = (): TrackPath | null => {
    const ps = paths();
    const c = chosen();
    if (c && ps.includes(c)) return c;
    const ref = props.picked()?.refs.find((r) => ps.includes(r.prop));
    return ref?.prop ?? ps[0] ?? null;
  };
  const track = () => {
    const l = layer();
    const p = path();
    return l && p ? trackAt(l, p) : undefined;
  };
  const H = () => Math.max(60, props.height() - RULER);
  const range = () => {
    const f = frozen();
    if (f) return f;
    const tr = track();
    const p = path()!;
    if (!tr) return { lo: 0, hi: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    const n = Math.min(400, Math.max(40, Math.round(props.width() / 3)));
    const d = ctrl.document.duration;
    for (let i = 0; i <= n; i++) {
      const v = evalTrack(tr, (i / n) * d, defaultOf(p));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const m = (hi - lo) * 0.1;
    return { lo: lo - m, hi: hi + m };
  };
  const yOf = (v: number) => {
    const r = range();
    return PAD + ((r.hi - v) / (r.hi - r.lo)) * (H() - 2 * PAD);
  };
  const curve = () => {
    const tr = track();
    const p = path();
    if (!tr || !p) return "";
    const n = Math.min(600, Math.max(40, Math.round(props.width() / 2)));
    const d = ctrl.document.duration;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * d;
      pts.push(`${props.xOf(t).toFixed(1)},${yOf(evalTrack(tr, t, defaultOf(p))).toFixed(1)}`);
    }
    return `M${pts.join("L")}`;
  };
  /** Straight lines between the keys: what the curve would be without easing. */
  const linear = () => (track()?.keys ?? []).map((k, i) => `${i ? "L" : "M"}${props.xOf(k.t).toFixed(1)},${yOf(k.value).toFixed(1)}`).join("");

  /** The picked segment on this track: its start key index. */
  const seg = () => {
    const tr = track();
    const p = path();
    const ref = props.picked()?.refs.find((r) => r.prop === p);
    if (!tr || !ref) return null;
    const i = tr.keys.findIndex((k) => k.id === ref.keyId);
    return i >= 0 && i < tr.keys.length - 1 ? i : null;
  };
  /** Segment geometry in pixels. A flat segment borrows a 60px rise so its handles can still move vertically. */
  const geo = () => {
    const i = seg();
    const tr = track();
    if (i === null || !tr) return null;
    const a = tr.keys[i]!;
    const b = tr.keys[i + 1]!;
    const x0 = props.xOf(a.t);
    const x1 = props.xOf(b.t);
    const y0 = yOf(a.value);
    const y1raw = yOf(b.value);
    const y1 = Math.abs(y1raw - y0) < 24 ? y0 - 60 : y1raw;
    // Linear is drawn with its handles a third of the way along: the same straight curve, but handles you can grab.
    const e: Bezier = a.ease ?? [1 / 3, 1 / 3, 2 / 3, 2 / 3];
    return { x0, y0, x1, y1, y1raw, e, h: [[x0 + e[0] * (x1 - x0), y0 + e[1] * (y1 - y0)], [x0 + e[2] * (x1 - x0), y0 + e[3] * (y1 - y0)]] as const };
  };
  const refs = () => {
    const l = layer();
    const p = path();
    const i = seg();
    const k = i === null ? undefined : track()?.keys[i];
    return l && p && k ? [{ layerId: l.id, prop: p, keyId: k.id }] : [];
  };
  const down = (which: 0 | 1, ev: PointerEvent) => {
    ev.stopPropagation();
    svg.setPointerCapture(ev.pointerId);
    setFrozen(range());
    setActive(which);
  };
  const move = (ev: PointerEvent) => {
    const w = active();
    const g = geo();
    if (w === null || !g || g.x1 === g.x0) return;
    const r = svg.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const ex = (px - g.x0) / (g.x1 - g.x0);
    const ey = (py - g.y0) / (g.y1 - g.y0);
    const e: Bezier = w === 0 ? [ex, ey, g.e[2], g.e[3]] : [g.e[0], g.e[1], ex, ey];
    ctrl.setPreview(setEase(refs(), e));
  };
  const up = () => {
    if (active() === null) return;
    const g = geo();
    const r = refs();
    setActive(null);
    setFrozen(null);
    ctrl.setPreview(null);
    if (g && r.length) ctrl.execute(setEase(r, g.e));
  };

  return (
    <div class="curves">
      <div class="cv-list">
        <div class="tl-label head">Animated properties</div>
        <For each={paths()} fallback={<p class="empty">{layer() ? "Nothing on this layer is animated yet. Turn on Auto-key and change a value at another time." : "Select a layer to see its curves."}</p>}>
          {(p) => (
            <button
              type="button"
              class="cv-prop"
              aria-pressed={path() === p}
              onClick={() => {
                setChosen(p);
                props.setPicked(null);
              }}>
              <span>{(props.tick(), layer() ? trackName(layer()!, p) : p)}</span>
              <span class="cv-val">{(props.tick(), layer() ? shown(p, evalTrack(trackAt(layer()!, p)!, ctrl.time, defaultOf(p))) : "")}</span>
            </button>
          )}
        </For>
      </div>
      <div class="cv-graph" style={{ width: `${props.width()}px` }}>
        <div class="tl-track ruler" style={{ width: `${props.width()}px` }} onPointerDown={props.rulerDown} onPointerMove={props.rulerMove}>
          <For each={props.ticks()}>{(s) => <span class="tick" style={{ left: `${props.xOf(s)}px` }}>{`${s}s`}</span>}</For>
          <Flag ctrl={ctrl} tick={props.tick} xOf={props.xOf} />
        </div>
        <Show when={track()}>
          {(tr) => (
            <svg
              ref={svg}
              class="cv-svg"
              width={props.width()}
              height={H()}
              role="img"
              aria-label={`Value graph of ${trackName(layer()!, path()!)}`}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}>
              <For each={[0.25, 0.5, 0.75]}>{(f) => <path class="cv-grid" d={`M0 ${(H() * f).toFixed(1)}H${props.width()}`} />}</For>
              <For each={props.ticks().slice(1)}>{(s) => <path class="cv-grid" d={`M${props.xOf(s).toFixed(1)} 0V${H()}`} />}</For>
              <path class="cv-linear" d={linear()} />
              <path class="g-curve" d={curve()} />
              <For each={tr().keys}>
                {(k, i) => {
                  const on = () => seg() === i() || props.picked()?.refs.some((r) => r.keyId === k.id && r.prop === path());
                  return (
                    <g
                      class="cv-key"
                      classList={{ picked: !!on() }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const l = layer();
                        const p = path();
                        if (l && p) props.setPicked({ t: k.t, refs: [{ layerId: l.id, prop: p, keyId: k.id }] });
                      }}>
                      <circle cx={props.xOf(k.t)} cy={yOf(k.value)} r="22" fill="transparent" />
                      <path d={`M${props.xOf(k.t)} ${yOf(k.value) - 9}l9 9-9 9-9-9z`} />
                    </g>
                  );
                }}
              </For>
              {/* Handles above the diamonds: a handle resting on a key must stay grabbable. */}
              <Show when={geo()}>
                {(g) => (
                  <>
                    <path class="g-arm" d={`M${g().x0} ${g().y0}L${g().h[0][0]} ${g().h[0][1]}M${g().x1} ${g().y1raw}L${g().h[1][0]} ${g().h[1][1]}`} />
                    <For each={[0, 1] as const}>
                      {(w) => (
                        <g class="g-handle-hit" onPointerDown={(e) => down(w, e)}>
                          <circle cx={g().h[w][0]} cy={g().h[w][1]} r="22" fill="transparent" />
                          <circle class="g-handle" cx={g().h[w][0]} cy={g().h[w][1]} r="7" />
                        </g>
                      )}
                    </For>
                  </>
                )}
              </Show>
            </svg>
          )}
        </Show>
      </div>
    </div>
  );
}

const LABEL: Record<string, string> = { "Ease in-out": "Ease both" };
const same = (a: Bezier | undefined, b: Bezier | undefined) => a === b || (!!a && !!b && a.every((v, i) => Math.abs(v - b[i]!) < 1e-6));

/** The easing of the picked keyframe's segment as a preset menu. */
export function EaseSelect(props: { ctrl: EditorController; tick: () => number; picked: () => KeyColumn | null }) {
  const ctrl = props.ctrl;
  const current = (): string | null => {
    props.tick();
    const ref = props.picked()?.refs[0];
    if (!ref) return null;
    const l = ctrl.document.layers.find((x) => x.id === ref.layerId);
    const tr = l ? trackAt(l, ref.prop) : undefined;
    const i = tr?.keys.findIndex((k) => k.id === ref.keyId) ?? -1;
    if (!tr || i < 0 || i === tr.keys.length - 1) return null;
    return PRESETS.find((p) => same(p.ease, tr.keys[i]!.ease))?.name ?? "custom";
  };
  return (
    <select
      class="sel cv-ease"
      aria-label="Easing"
      disabled={current() === null}
      onChange={(e) => {
        const p = PRESETS.find((x) => x.name === e.currentTarget.value);
        const col = props.picked();
        if (p && col) ctrl.execute(setEase(col.refs, p.ease));
      }}>
      <Show when={current() !== null} fallback={<option value="">Easing: tap a keyframe</option>}>
        <For each={PRESETS}>{(p) => <option value={p.name} selected={current() === p.name}>{`Easing: ${LABEL[p.name] ?? p.name}`}</option>}</For>
        <Show when={current() === "custom"}>
          <option value="custom" selected>Easing: Custom</option>
        </Show>
      </Show>
    </select>
  );
}
