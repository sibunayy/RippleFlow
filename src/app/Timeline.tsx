import { createSignal, For, Index, Show } from "solid-js";
import { duplicateLayer, moveLayer, moveLayerInTime, renameLayer, setHidden, setInOut } from "../core/commands";
import { nextLayerNumber } from "./shapes";
import type { EditorController } from "../editor/controller";
import { deleteKeys, isAnimated, keyColumns, moveKeys, snapToFrame, type KeyColumn } from "../editor/keyframeEdit";

const LABEL_W = 132;

interface Drag {
  col: KeyColumn;
  layerId: string;
  startX: number;
  dt: number;
}

/** Layer list on the left, keyframe diamonds on the right, ruler on top. */
export function Timeline(props: {
  ctrl: EditorController;
  tick: () => number;
  picked: () => KeyColumn | null;
  setPicked: (c: KeyColumn | null) => void;
}) {
  const ctrl = props.ctrl;
  let track!: HTMLDivElement;
  const picked = props.picked;
  const setPicked = props.setPicked;
  const [pickedLayer, setPickedLayer] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [trim, setTrim] = createSignal<{ id: string; edge: "in" | "out"; t: number } | null>(null);

  const [slide, setSlide] = createSignal<{ id: string; x0: number; dt: number } | null>(null);
  const range = (l: { id: string; inPoint?: number; outPoint?: number }): [number, number] => {
    const sl = slide();
    if (sl?.id === l.id) return [(l.inPoint ?? 0) + sl.dt, (l.outPoint ?? ctrl.document.duration) + sl.dt];
    const tr = trim();
    const a = l.inPoint ?? 0;
    const b = l.outPoint ?? ctrl.document.duration;
    return tr?.id === l.id ? (tr.edge === "in" ? [tr.t, b] : [a, tr.t]) : [a, b];
  };
  const trimMove = (e: PointerEvent, l: { id: string; inPoint?: number; outPoint?: number }, edge: "in" | "out") => {
    const cur = trim();
    if (!cur || cur.id !== l.id || cur.edge !== edge) return;
    const r = track.getBoundingClientRect();
    const frame = 1 / ctrl.document.fps;
    const t = tOf(e.clientX - r.left);
    const a = l.inPoint ?? 0;
    const b = l.outPoint ?? ctrl.document.duration;
    setTrim({ id: l.id, edge, t: edge === "in" ? Math.min(t, b - frame) : Math.max(t, a + frame) });
  };
  const trimUp = (l: { id: string; inPoint?: number; outPoint?: number }) => {
    const cur = trim();
    setTrim(null);
    if (!cur) return;
    const [a, b] = [cur.edge === "in" ? cur.t : (l.inPoint ?? 0), cur.edge === "out" ? cur.t : (l.outPoint ?? ctrl.document.duration)];
    ctrl.execute(setInOut(l.id, a, b));
  };

  const width = () => track?.clientWidth || 1;
  const xOf = (t: number) => (t / ctrl.document.duration) * width();
  const tOf = (x: number) => snapToFrame(Math.min(Math.max((x / width()) * ctrl.document.duration, 0), ctrl.document.duration), ctrl.document.fps);
  const layers = () => (props.tick(), [...ctrl.document.layers].reverse()); // top layer first

  const scrub = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    ctrl.setTime(tOf(e.clientX - r.left));
  };
  const rulerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
    const raw = ((e.clientX - d.startX) / width()) * ctrl.document.duration;
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
  const dup = () => {
    const id = ctrl.selection;
    if (!id) return;
    const newId = `layer-${nextLayerNumber(ctrl.document.layers)}`;
    ctrl.execute(duplicateLayer(id, newId));
    ctrl.setSelection(newId);
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
  const shift = (dir: 1 | -1) => {
    const id = ctrl.selection;
    if (!id) return;
    const i = ctrl.document.layers.findIndex((l) => l.id === id);
    ctrl.execute(moveLayer(id, i + dir));
  };

  return (
    <div class="timeline">
      <div class="tl-tools">
        <button onClick={() => shift(1)} disabled={(props.tick(), ctrl.selection === null)}>Raise</button>
        <button onClick={() => shift(-1)} disabled={(props.tick(), ctrl.selection === null)}>Lower</button>
        <button onClick={dup} disabled={(props.tick(), ctrl.selection === null)}>Duplicate</button>
        <button onClick={rename} disabled={(props.tick(), ctrl.selection === null)}>Rename</button>
        <button onClick={delKey} disabled={picked() === null}>Delete key</button>
        <span class="hint">Drag a diamond to retime. Tap the ruler to scrub.</span>
      </div>
      <div class="tl-body">
        <div class="tl-row tl-head">
          <div class="tl-label" />
          <div class="tl-track ruler" ref={track} onPointerDown={rulerDown} onPointerMove={rulerMove}>
            <For each={Array.from({ length: Math.floor(ctrl.document.duration) + 1 }, (_, i) => i)}>
              {(s) => (
                <span class="tick" style={{ left: `${xOf(s)}px` }}>
                  {s}s
                </span>
              )}
            </For>
          </div>
        </div>
        <For each={layers()}>
          {(layer) => (
            <div class="tl-row" classList={{ on: (props.tick(), ctrl.selection === layer.id) }}>
              <div class="tl-label" onClick={() => ctrl.setSelection(layer.id)} style={{ "padding-left": `${12 + 12 * (props.tick(), depth(layer.id))}px` }}>
                <button
                  class="eye"
                  classList={{ off: (props.tick(), layer.hidden === true) }}
                  aria-label={layer.hidden ? "Show layer" : "Hide layer"}
                  aria-pressed={layer.hidden !== true}
                  onClick={(e) => {
                    e.stopPropagation();
                    ctrl.execute(setHidden(layer.id, layer.hidden !== true));
                  }}
                >
                  {layer.hidden ? "◌" : "●"}
                </button>
                {layer.name}
              </div>
              <div class="tl-track">
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
                    const b = layer.outPoint ?? ctrl.document.duration;
                    const raw = ((e.clientX - sl.x0) / width()) * ctrl.document.duration;
                    const dt = Math.min(Math.max(snapToFrame(raw, ctrl.document.fps), -a), ctrl.document.duration - b);
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
                      setTrim({ id: layer.id, edge: "out", t: layer.outPoint ?? ctrl.document.duration });
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
                    return (
                      <span
                        class="key"
                        classList={{ picked: picked()?.refs[0]?.keyId === col().refs[0]?.keyId && pickedLayer() === layer.id }}
                        style={{ left: `${x()}px` }}
                        onPointerDown={(e) => keyDown(e, layer.id, col())}
                        onPointerMove={keyMove}
                        onPointerUp={keyUp}
                        onPointerCancel={() => setDrag(null)}
                      />
                    );
                  }}
                </Index>
              </div>
            </div>
          )}
        </For>
        <div class="playhead" style={{ left: `${LABEL_W + xOf((props.tick(), ctrl.time))}px` }} />
        <Show when={ctrl.document.layers.length === 0}>
          <p class="empty">Add a shape, then turn on Auto-key and move it at different times.</p>
        </Show>
      </div>
    </div>
  );
}
