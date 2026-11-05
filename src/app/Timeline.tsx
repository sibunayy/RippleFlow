import { createSignal, For, Index, Show } from "solid-js";
import { moveLayer } from "../core/commands";
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
export function Timeline(props: { ctrl: EditorController; tick: () => number }) {
  const ctrl = props.ctrl;
  let track!: HTMLDivElement;
  const [picked, setPicked] = createSignal<KeyColumn | null>(null);
  const [pickedLayer, setPickedLayer] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<Drag | null>(null);

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
              <div class="tl-label" onClick={() => ctrl.setSelection(layer.id)}>
                {layer.name}
              </div>
              <div class="tl-track">
                {/* Index, not For: the diamond under the pen must survive the re-render a selection change causes. */}
                <Index each={(props.tick(), isAnimated(layer) ? keyColumns(layer) : [])}>
                  {(col) => {
                    const dragging = () => drag()?.col.refs[0]?.keyId === col().refs[0]?.keyId && drag()?.layerId === layer.id;
                    const x = () => xOf(col().t + (dragging() ? drag()!.dt : 0));
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
