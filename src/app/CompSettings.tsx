import { For } from "solid-js";
import { setBackground, setCanvas, setDuration } from "../core/commands";
import type { Command } from "../core/history";
import type { Composition } from "../core/types";
import { hexToRgba, rgbToHex } from "../editor/color";

const SIZES = [
  { label: "16:9 · 1920×1080", w: 1920, h: 1080 },
  { label: "9:16 · 1080×1920", w: 1080, h: 1920 },
  { label: "1:1 · 1080×1080", w: 1080, h: 1080 },
  { label: "4:5 · 1080×1350", w: 1080, h: 1350 },
];
const FPS = [24, 30, 60];

/** Canvas size, frame rate, length and backdrop colour. */
export function CompSettings(p: { comp: () => Composition; run: (cmd: Command) => void; onClose: () => void }) {
  const num = (label: string, value: () => number, min: number, max: number, mk: (v: number) => Command, step = 1) => (
    <label class="field">
      {label}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value()}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          if (Number.isFinite(v)) p.run(mk(Math.min(max, Math.max(min, v))));
          e.currentTarget.value = String(value());
        }}
      />
    </label>
  );
  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label="Composition settings">
      <div class="sheet">
        <h2>Composition</h2>
        <div class="presets" role="group" aria-label="Canvas size">
          <For each={SIZES}>
            {(s) => (
              <button classList={{ on: p.comp().width === s.w && p.comp().height === s.h }} onClick={() => p.run(setCanvas({ width: s.w, height: s.h }))}>
                {s.label}
              </button>
            )}
          </For>
        </div>
        <div class="comp-grid">
          {num("Width", () => p.comp().width, 16, 4096, (v) => setCanvas({ width: v }))}
          {num("Height", () => p.comp().height, 16, 4096, (v) => setCanvas({ height: v }))}
          {num("Length (s)", () => p.comp().duration, 0.1, 600, (v) => setDuration(v), 0.5)}
        </div>
        <div class="presets" role="group" aria-label="Frame rate">
          <For each={FPS}>
            {(f) => (
              <button classList={{ on: p.comp().fps === f }} onClick={() => p.run(setCanvas({ fps: f }))}>
                {f} fps
              </button>
            )}
          </For>
        </div>
        <label class="field">
          Background
          <input type="color" aria-label="Background colour" value={rgbToHex(p.comp().background ?? [1, 1, 1, 1])} onInput={(e) => { const c = hexToRgba(e.currentTarget.value, 1); if (c) p.run(setBackground(c)); }} />
        </label>
        <p class="hint">Exports use this shape. The scene stays where it is when the size changes.</p>
        <div class="row">
          <button class="primary" onClick={p.onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
