import { createSignal, Show } from "solid-js";
import { scrubValue, TAP_SLOP } from "../editor/scrub";

export interface ScrubFieldProps {
  label: string;
  /** Current value in display units. */
  value: () => number;
  /** Display units per horizontal pixel of drag. */
  perPx: number;
  min?: number;
  max?: number;
  decimals?: number;
  /** Compact form from the design: no label above, a short prefix (X, W, #) inside the field. The label stays as its accessible name. */
  inline?: boolean;
  prefix?: string;
  /** Unit shown after the number (%, °, s). */
  suffix?: string;
  /** Called on every drag step (show it without recording history). */
  onPreview: (v: number) => void;
  /** Called once when a drag ends or a typed value is entered (record it). */
  onCommit: (v: number) => void;
}

/**
 * A number you can drag across to change (no separate slider), or tap to type.
 * Drag away vertically for fine control. Works with Pencil, finger and mouse.
 */
export function ScrubField(p: ScrubFieldProps) {
  let input!: HTMLInputElement;
  const [editing, setEditing] = createSignal(false);
  const [live, setLive] = createSignal<number | null>(null);
  let drag: { id: number; x0: number; y0: number; start: number; moved: boolean; last: number } | null = null;
  const dec = () => p.decimals ?? 2;
  const shown = () => +(live() ?? p.value()).toFixed(dec());

  const down = (e: PointerEvent) => {
    if (editing()) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, start: p.value(), moved: false, last: p.value() };
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    drag.moved = true;
    const v = scrubValue(drag.start, dx, dy, { perPx: p.perPx, min: p.min, max: p.max, decimals: dec() });
    drag.last = v;
    setLive(v);
    p.onPreview(v);
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      p.onCommit(d.last);
      setLive(null);
    } else {
      setEditing(true);
      input.focus();
      input.select();
    }
  };
  const cancel = () => {
    if (drag?.moved) p.onCommit(drag.start);
    drag = null;
    setLive(null);
  };

  return (
    <div class="scrub" classList={{ editing: editing(), inline: !!p.inline, pre: !!p.prefix, suf: !!p.suffix }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
      <Show when={!p.inline}>
        <span class="scrub-label">{p.label}</span>
      </Show>
      <Show when={p.prefix}>
        <span class="scrub-pre" aria-hidden="true">{p.prefix}</span>
      </Show>
      <input
        ref={input}
        type="number"
        inputmode="decimal"
        aria-label={p.label}
        step="any"
        value={shown()}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber;
          if (Number.isFinite(v)) p.onCommit(v);
          // Re-sync if the value was rejected or clamped.
          e.currentTarget.value = String(shown());
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <Show when={p.suffix}>
        <span class="scrub-suf" aria-hidden="true">{p.suffix}</span>
      </Show>
    </div>
  );
}
