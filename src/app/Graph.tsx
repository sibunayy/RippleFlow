import { createSignal, For, Show, type Accessor } from "solid-js";
import { cubicBezier } from "../core/easing";
import type { Bezier } from "../core/types";
import type { EditorController } from "../editor/controller";
import { PRESETS, setEase } from "../editor/easingEdit";
import { trackAt, type KeyColumn } from "../editor/keyframeEdit";

const SIZE = 240;
const PAD = 28;
const Y_MIN = -0.75;
const Y_MAX = 1.75;
const LINEAR: Bezier = [0, 0, 1, 1];

const px = (x: number) => PAD + x * (SIZE - 2 * PAD);
const py = (y: number) => PAD + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * (SIZE - 2 * PAD);
const fromPx = (X: number, Y: number): [number, number] => [
  Math.min(1, Math.max(0, (X - PAD) / (SIZE - 2 * PAD))),
  Math.min(Y_MAX, Math.max(Y_MIN, Y_MAX - ((Y - PAD) / (SIZE - 2 * PAD)) * (Y_MAX - Y_MIN))),
];

/** Easing editor for the segment that starts at the picked keyframe diamond. */
export function Graph(props: { ctrl: EditorController; tick: () => number; picked: Accessor<KeyColumn | null> }) {
  const [live, setLive] = createSignal<Bezier | null>(null);
  const [active, setActive] = createSignal<0 | 1 | null>(null);
  let svg!: SVGSVGElement;

  const stored = (): Bezier | undefined => {
    props.tick();
    const col = props.picked();
    const ref = col?.refs[0];
    if (!ref) return undefined;
    const layer = props.ctrl.document.layers.find((l) => l.id === ref.layerId);
    return layer ? trackAt(layer, ref.prop)?.keys.find((k) => k.id === ref.keyId)?.ease : undefined;
  };
  const ease = (): Bezier => live() ?? stored() ?? LINEAR;

  const curve = () => {
    const e = ease();
    const pts: string[] = [];
    for (let i = 0; i <= 48; i++) {
      const x = i / 48;
      pts.push(`${px(x).toFixed(1)},${py(cubicBezier(e, x)).toFixed(1)}`);
    }
    return pts.join(" ");
  };

  const down = (i: 0 | 1, ev: PointerEvent) => {
    ev.stopPropagation();
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    setActive(i);
    setLive(ease());
  };
  const move = (ev: PointerEvent) => {
    const i = active();
    const cur = live();
    if (i === null || !cur) return;
    const r = svg.getBoundingClientRect();
    const [x, y] = fromPx(((ev.clientX - r.left) / r.width) * SIZE, ((ev.clientY - r.top) / r.height) * SIZE);
    setLive(i === 0 ? [x, y, cur[2], cur[3]] : [cur[0], cur[1], x, y]);
  };
  const up = () => {
    const e = live();
    setActive(null);
    setLive(null);
    const col = props.picked();
    if (e && col) props.ctrl.execute(setEase(col.refs, e));
  };
  const preset = (e: Bezier | undefined) => {
    const col = props.picked();
    if (col) props.ctrl.execute(setEase(col.refs, e));
  };

  return (
    <Show when={props.picked()}>
      <div class="graph">
        <strong>Easing</strong>
        <svg ref={svg} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { setActive(null); setLive(null); }}>
          <rect x={px(0)} y={py(1)} width={px(1) - px(0)} height={py(0) - py(1)} class="g-box" />
          <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} class="g-lin" />
          <polyline points={curve()} class="g-curve" />
          <line x1={px(0)} y1={py(0)} x2={px(ease()[0])} y2={py(ease()[1])} class="g-arm" />
          <line x1={px(1)} y1={py(1)} x2={px(ease()[2])} y2={py(ease()[3])} class="g-arm" />
          <circle cx={px(ease()[0])} cy={py(ease()[1])} r="13" class="g-handle" onPointerDown={(e) => down(0, e)} />
          <circle cx={px(ease()[2])} cy={py(ease()[3])} r="13" class="g-handle" onPointerDown={(e) => down(1, e)} />
        </svg>
        <div class="presets">
          <For each={PRESETS}>{(p) => <button onClick={() => preset(p.ease)}>{p.name}</button>}</For>
        </div>
      </div>
    </Show>
  );
}
