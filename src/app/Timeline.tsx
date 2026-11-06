import { createEffect, createSignal, For, Index, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { moveLayer, moveLayerInTime, renameLayer, setHidden, setInOut } from "../core/commands";
import type { EditorController } from "../editor/controller";
import { deleteKeys, isAnimated, keyColumns, moveKeys, snapToFrame, type KeyColumn } from "../editor/keyframeEdit";
import { Curves, EaseSelect } from "./Curves";
import { Icon } from "./icons";

/** Width of the layer-name column; the playhead and keys are offset by it. */
export const LABEL_W = 176;
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];
/** Room before 0 s and after the end, so the first and last diamonds are not under the label column or clipped. */
export const INSET = 14;
const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];

interface Drag {
  col: KeyColumn;
  layerId: string;
  startX: number;
  dt: number;
}

/** The playhead's time label, riding on the ruler. */
export function Flag(p: { ctrl: EditorController; tick: () => number; xOf: (t: number) => number }) {
  return (
    <span class="playhead-flag" aria-hidden="true" style={{ left: `${p.xOf((p.tick(), p.ctrl.time))}px` }}>
      {(p.tick(), p.ctrl.time.toFixed(2))}
    </span>
  );
}

export const fmtTime = (t: number): string => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;

/** Transport, Auto-key, and the layer timeline (Keys) or the value graph of one property (Curves). */
export function Timeline(props: {
  ctrl: EditorController;
  tick: () => number;
  picked: () => KeyColumn | null;
  setPicked: (c: KeyColumn | null) => void;
  playing: Accessor<boolean>;
  setPlaying: (v: boolean) => void;
  onResize: (dy: number, done: boolean) => void;
}) {
  const ctrl = props.ctrl;
  let body!: HTMLDivElement;
  const picked = props.picked;
  const setPicked = props.setPicked;
  const [view, setView] = createSignal<"keys" | "curves">("keys");
  const [zoom, setZoom] = createSignal(0);
  const [vw, setVw] = createSignal(800);
  const [vh, setVh] = createSignal(200);
  /** The overflow menu, anchored above its button (fixed, so the timeline panel cannot clip it). */
  const [menu, setMenu] = createSignal<{ right: number; bottom: number } | null>(null);
  const [pickedLayer, setPickedLayer] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [trim, setTrim] = createSignal<{ id: string; edge: "in" | "out"; t: number } | null>(null);
  const [slide, setSlide] = createSignal<{ id: string; x0: number; dt: number } | null>(null);
  const [autoKey, setAutoKey] = createSignal(ctrl.autoKey);

  onMount(() => {
    const ro = new ResizeObserver(() => {
      setVw(body.clientWidth);
      setVh(body.clientHeight);
    });
    ro.observe(body);
    onCleanup(() => ro.disconnect());
  });

  const dur = () => (props.tick(), ctrl.document.duration);
  /** Pixels of track for the whole composition. */
  const width = () => Math.max(1, (vw() - LABEL_W - 2 * INSET) * ZOOMS[zoom()]!);
  const full = () => width() + 2 * INSET;
  const xOf = (t: number) => INSET + (t / dur()) * width();
  const tOf = (x: number) => snapToFrame(Math.min(Math.max(((x - INSET) / width()) * dur(), 0), dur()), ctrl.document.fps);
  const step = () => STEPS.find((s) => xOf(s) - INSET >= 90) ?? 60;
  const ticks = () => Array.from({ length: Math.floor(dur() / step() + 1e-6) + 1 }, (_, i) => +(i * step()).toFixed(3));
  const layers = () => (props.tick(), [...ctrl.document.layers].reverse()); // top layer first

  const range = (l: { id: string; inPoint?: number; outPoint?: number }): [number, number] => {
    const sl = slide();
    if (sl?.id === l.id) return [(l.inPoint ?? 0) + sl.dt, (l.outPoint ?? dur()) + sl.dt];
    const tr = trim();
    const a = l.inPoint ?? 0;
    const b = l.outPoint ?? dur();
    return tr?.id === l.id ? (tr.edge === "in" ? [tr.t, b] : [a, tr.t]) : [a, b];
  };
  const trackX = (e: PointerEvent) => e.clientX - body.getBoundingClientRect().left + body.scrollLeft - LABEL_W;
  const trimMove = (e: PointerEvent, l: { id: string; inPoint?: number; outPoint?: number }, edge: "in" | "out") => {
    const cur = trim();
    if (!cur || cur.id !== l.id || cur.edge !== edge) return;
    const frame = 1 / ctrl.document.fps;
    const t = tOf(trackX(e));
    const a = l.inPoint ?? 0;
    const b = l.outPoint ?? dur();
    setTrim({ id: l.id, edge, t: edge === "in" ? Math.min(t, b - frame) : Math.max(t, a + frame) });
  };
  const trimUp = (l: { id: string; inPoint?: number; outPoint?: number }) => {
    const cur = trim();
    setTrim(null);
    if (!cur) return;
    const [a, b] = [cur.edge === "in" ? cur.t : (l.inPoint ?? 0), cur.edge === "out" ? cur.t : (l.outPoint ?? dur())];
    ctrl.execute(setInOut(l.id, a, b));
  };

  const scrub = (e: PointerEvent) => ctrl.setTime(tOf(trackX(e)));
  const rulerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    props.setPlaying(false);
    scrub(e);
  };
  const rulerMove = (e: PointerEvent) => {
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) scrub(e);
  };

  const keyDown = (e: PointerEvent, layerId: string, col: KeyColumn) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPicked(col);
    setPickedLayer(layerId);
    ctrl.setSelection(layerId);
    setDrag({ col, layerId, startX: e.clientX, dt: 0 });
  };
  const keyMove = (e: PointerEvent) => {
    const d = drag();
    if (!d) return;
    const raw = ((e.clientX - d.startX) / width()) * dur();
    const target = snapToFrame(d.col.t + raw, ctrl.document.fps);
    setDrag({ ...d, dt: target - d.col.t });
  };
  const keyUp = () => {
    const d = drag();
    setDrag(null);
    if (d && Math.abs(d.dt) > 1e-9) {
      ctrl.execute(moveKeys(d.col.refs, d.dt));
      setPicked(null); // key ids survive, but the column moved
    }
  };

  const delKey = () => {
    const c = picked();
    if (c) ctrl.execute(deleteKeys(c.refs));
    setPicked(null);
  };
  const rename = () => {
    const l = ctrl.document.layers.find((x) => x.id === ctrl.selection);
    const name = l ? window.prompt("Layer name", l.name) : null;
    if (l && name) ctrl.execute(renameLayer(l.id, name));
  };
  const depth = (id: string): number => {
    const byId = new Map(ctrl.document.layers.map((l) => [l.id, l]));
    let n = 0;
    for (let cur = byId.get(id)?.parent; cur !== undefined && n < 8; cur = byId.get(cur)?.parent) n++;
    return n;
  };
  const [rdrag, setRdrag] = createSignal<{ id: string; to: number } | null>(null);
  const rowIndexAt = (y: number): number => {
    const rows = Array.from(body.querySelectorAll<HTMLElement>(".tl-row:not(.tl-head)"));
    let k = rows.findIndex((r) => y < r.getBoundingClientRect().bottom);
    if (k < 0) k = rows.length - 1;
    return Math.max(0, k);
  };
  const shift = (dir: 1 | -1) => {
    const id = ctrl.selection;
    if (!id) return;
    const i = ctrl.document.layers.findIndex((l) => l.id === id);
    ctrl.execute(moveLayer(id, i + dir));
  };
  const act = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  // Keep the playhead in view while playing on a zoomed timeline.
  createEffect(() => {
    props.tick();
    if (!props.playing() || zoom() === 0 || !body) return;
    const x = LABEL_W + xOf(ctrl.time);
    if (x < body.scrollLeft + LABEL_W || x > body.scrollLeft + body.clientWidth - 24) body.scrollLeft = x - LABEL_W - 24;
  });

  let grab: { id: number; y: number } | null = null;
  return (
    <section class="timeline" classList={{ "ak-on": autoKey() }} aria-label="Timeline">
      <div class="tl-tools">
        <span
          class="grabber"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize timeline"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            grab = { id: e.pointerId, y: e.clientY };
          }}
          onPointerMove={(e) => {
            if (grab?.id === e.pointerId) props.onResize(grab.y - e.clientY, false);
          }}
          onPointerUp={(e) => {
            if (grab?.id === e.pointerId) props.onResize(grab.y - e.clientY, true);
            grab = null;
          }}
          onPointerCancel={() => {
            props.onResize(0, true);
            grab = null;
          }}
        />
        <button type="button" class="play" aria-label={props.playing() ? "Pause" : "Play"} onClick={() => props.setPlaying(!props.playing())}>
          <Icon name={props.playing() ? "pause" : "play"} size={26} />
        </button>
        <div class="clock">
          <span class="time">{(props.tick(), fmtTime(ctrl.time))}</span>
          <span class="of">/ {dur().toFixed(1)}</span>
        </div>
        <button
          type="button"
          class="autokey"
          classList={{ on: autoKey() }}
          aria-pressed={autoKey()}
          title="Record changes as keyframes"
          onClick={() => {
            ctrl.autoKey = !ctrl.autoKey;
            setAutoKey(ctrl.autoKey);
          }}>
          <Icon name="record" size={20} stroke={autoKey() ? 0 : 2} fill={autoKey() ? "currentColor" : "none"} />
          {autoKey() ? "Auto-key on" : "Auto-key off"}
        </button>
        <span class="spacer" />
        <div class="tl-right">
          <div class="seg-pill" role="group" aria-label="Timeline view">
            <button type="button" aria-pressed={view() === "keys"} onClick={() => setView("keys")}>Keys</button>
            <button type="button" aria-pressed={view() === "curves"} onClick={() => setView("curves")}>Curves</button>
          </div>
          <button type="button" class="round" aria-label="Zoom out timeline" disabled={zoom() === 0} onClick={() => setZoom(Math.max(0, zoom() - 1))}>
            <Icon name="minus" />
          </button>
          <button type="button" class="round" aria-label="Zoom in timeline" disabled={zoom() === ZOOMS.length - 1} onClick={() => setZoom(Math.min(ZOOMS.length - 1, zoom() + 1))}>
            <Icon name="plus" />
          </button>
          <div class="menu-wrap">
            <button type="button" class="round" aria-label="More layer actions" aria-expanded={!!menu()} aria-haspopup="menu" onClick={(e) => {
              if (menu()) return setMenu(null);
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ right: innerWidth - r.right, bottom: innerHeight - r.top + 8 });
            }}>
              <Icon name="more" />
            </button>
            <Show when={menu()}>
              {(m) => (
              <>
              <div class="scrim" onPointerDown={() => setMenu(null)} />
              <div class="menu" role="menu" aria-label="Layer actions" style={{ right: `${m().right}px`, bottom: `${m().bottom}px` }}>
                <button type="button" role="menuitem" disabled={(props.tick(), ctrl.selection === null)} onClick={act(() => shift(1))}>Raise layer</button>
                <button type="button" role="menuitem" disabled={(props.tick(), ctrl.selection === null)} onClick={act(() => shift(-1))}>Lower layer</button>
                <button type="button" role="menuitem" disabled={(props.tick(), ctrl.selection === null)} onClick={act(rename)}>Rename layer</button>
                <button type="button" role="menuitem" class="danger" disabled={picked() === null} onClick={act(delKey)}>Delete keyframe</button>
              </div>
              </>
              )}
            </Show>
          </div>
        </div>
      </div>
      <div class="tl-body" ref={body}>
        <div class="tl-content" style={{ width: `${LABEL_W + full()}px` }}>
        <Show when={view() === "keys"} fallback={<Curves ctrl={ctrl} tick={props.tick} picked={picked} setPicked={setPicked} width={full} height={vh} xOf={xOf} ticks={ticks} rulerDown={rulerDown} rulerMove={rulerMove} />}>
          <div class="tl-row tl-head">
            <div class="tl-label head">Layers</div>
            <div class="tl-track ruler" style={{ width: `${full()}px` }} onPointerDown={rulerDown} onPointerMove={rulerMove}>
              <For each={ticks()}>{(s) => <span class="tick" style={{ left: `${xOf(s)}px` }}>{`${s}s`}</span>}</For>
              <Flag ctrl={ctrl} tick={props.tick} xOf={xOf} />
            </div>
          </div>
          <For each={layers()}>
            {(layer) => {
              const on = () => (props.tick(), ctrl.selection === layer.id);
              return (
                <div class="tl-row" classList={{ on: on(), dragging: rdrag()?.id === layer.id, hidden: layer.hidden === true }}>
                  <div class="tl-label" onClick={() => ctrl.setSelection(layer.id)}>
                    <button
                      type="button"
                      class="eye"
                      aria-label={layer.hidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
                      aria-pressed={layer.hidden !== true}
                      onClick={(e) => {
                        e.stopPropagation();
                        ctrl.execute(setHidden(layer.id, layer.hidden !== true));
                      }}>
                      <Icon name={layer.hidden ? "eyeOff" : "eye"} size={20} />
                    </button>
                    <span class="tl-name" style={{ "padding-left": `${12 * (props.tick(), depth(layer.id))}px` }}>{layer.name}</span>
                    <button
                      type="button"
                      class="grip"
                      aria-label={`Reorder ${layer.name}`}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        ctrl.setSelection(layer.id);
                        setRdrag({ id: layer.id, to: rowIndexAt(e.clientY) });
                      }}
                      onPointerMove={(e) => {
                        const d = rdrag();
                        if (d && d.id === layer.id) setRdrag({ ...d, to: rowIndexAt(e.clientY) });
                      }}
                      onPointerUp={() => {
                        const d = rdrag();
                        setRdrag(null);
                        if (!d || d.id !== layer.id) return;
                        // rows are top-first; stack index 0 is the bottom
                        const target = ctrl.document.layers.length - 1 - d.to;
                        if (target !== ctrl.document.layers.findIndex((l) => l.id === d.id)) ctrl.execute(moveLayer(d.id, target));
                      }}
                      onPointerCancel={() => setRdrag(null)}>
                      <Icon name="grip" size={20} />
                    </button>
                  </div>
                  <div class="tl-track" style={{ width: `${full()}px` }}>
                    <div
                      class="bar-range"
                      onPointerDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        ctrl.setSelection(layer.id);
                        setSlide({ id: layer.id, x0: e.clientX, dt: 0 });
                      }}
                      onPointerMove={(e) => {
                        const sl = slide();
                        if (!sl || sl.id !== layer.id) return;
                        const a = layer.inPoint ?? 0;
                        const b = layer.outPoint ?? dur();
                        const raw = ((e.clientX - sl.x0) / width()) * dur();
                        const dt = Math.min(Math.max(snapToFrame(raw, ctrl.document.fps), -a), dur() - b);
                        setSlide({ ...sl, dt });
                      }}
                      onPointerUp={() => {
                        const sl = slide();
                        setSlide(null);
                        if (sl && sl.id === layer.id && sl.dt !== 0) ctrl.execute(moveLayerInTime(layer.id, sl.dt));
                      }}
                      onPointerCancel={() => setSlide(null)}
                      style={{ left: `${xOf(range(layer)[0])}px`, width: `${xOf(range(layer)[1]) - xOf(range(layer)[0])}px` }}>
                      <span
                        class="trim in"
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          ctrl.setSelection(layer.id);
                          setTrim({ id: layer.id, edge: "in", t: layer.inPoint ?? 0 });
                        }}
                        onPointerMove={(e) => trimMove(e, layer, "in")}
                        onPointerUp={() => trimUp(layer)}
                        onPointerCancel={() => setTrim(null)}
                      />
                      <span
                        class="trim out"
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          ctrl.setSelection(layer.id);
                          setTrim({ id: layer.id, edge: "out", t: layer.outPoint ?? dur() });
                        }}
                        onPointerMove={(e) => trimMove(e, layer, "out")}
                        onPointerUp={() => trimUp(layer)}
                        onPointerCancel={() => setTrim(null)}
                      />
                    </div>
                    {/* Index, not For: the diamond under the pen must survive the re-render a selection change causes. */}
                    <Index each={(props.tick(), isAnimated(layer) ? keyColumns(layer) : [])}>
                      {(col) => {
                        const dragging = () => drag()?.col.refs[0]?.keyId === col().refs[0]?.keyId && drag()?.layerId === layer.id;
                        const x = () => xOf(col().t + (dragging() ? drag()!.dt : 0) + (slide()?.id === layer.id ? slide()!.dt : 0));
                        const isPicked = () => picked()?.refs[0]?.keyId === col().refs[0]?.keyId && pickedLayer() === layer.id;
                        return (
                          <button
                            type="button"
                            class="key"
                            classList={{ picked: isPicked() }}
                            aria-label={`Keyframe at ${col().t.toFixed(1)} seconds`}
                            aria-pressed={isPicked()}
                            style={{ left: `${x()}px` }}
                            onPointerDown={(e) => keyDown(e, layer.id, col())}
                            onPointerMove={keyMove}
                            onPointerUp={keyUp}
                            onPointerCancel={() => setDrag(null)}>
                            <Icon name="diamond" size={18} stroke={1.5} fill="currentColor" />
                          </button>
                        );
                      }}
                    </Index>
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={(props.tick(), ctrl.document.layers.length === 0)}>
            <p class="empty">Add a shape from the tool rail, turn on Auto-key, then move it at different times.</p>
          </Show>
        </Show>
        <span class="playhead" style={{ left: `${LABEL_W + xOf((props.tick(), ctrl.time))}px` }} />
        </div>
      </div>
      <Show when={view() === "curves"}>
        <EaseSelect ctrl={ctrl} tick={props.tick} picked={picked} />
      </Show>
    </section>
  );
}
