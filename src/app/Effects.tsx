import { createSignal, For, Show } from "solid-js";
import { addEffect, moveEffect, removeEffect } from "../core/commands";
import type { Command } from "../core/history";
import { evalTrack } from "../core/evaluate";
import { EFFECT_BY_TYPE, EFFECTS, newEffect } from "../core/effects";
import type { EffectType, Layer } from "../core/types";
import type { EditorController } from "../editor/controller";
import { hexToRgba, rgbToHex } from "../editor/color";
import { setEffectColor, setEffectEnabled, setEffectValue } from "../editor/effectEdit";
import { ScrubField } from "./ScrubField";

/** The effect stack of the selected layer: add, reorder, switch off, remove, and edit each effect's values. */
export function Effects(props: { ctrl: EditorController; tick: () => number; layer: () => Layer; notify: (m: string) => void }) {
  const { ctrl } = props;
  const [picking, setPicking] = createSignal(false);
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
      /* not shown */
    }
  };
  const add = (type: EffectType) => {
    setPicking(false);
    run(addEffect(props.layer().id, newEffect(type, `fx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`)));
  };

  return (
    <div class="style-group fx">
      <div class="fx-head">
        <span class="scrub-label">Effects</span>
        <button class="mini wide" aria-expanded={picking()} onClick={() => setPicking(!picking())}>
          + Add effect
        </button>
      </div>
      <Show when={picking()}>
        <div class="fx-menu">
          <For each={EFFECTS}>{(s) => <button onClick={() => add(s.type)}>{s.label}</button>}</For>
        </div>
      </Show>
      <For each={props.layer().effects ?? []}>
        {(fx, i) => {
          const lid = () => props.layer().id;
          const spec = EFFECT_BY_TYPE[fx.type];
          const count = () => (props.layer().effects ?? []).length;
          return (
            <div class="fx-card" classList={{ off: fx.enabled === false }}>
              <div class="fx-title">
                <strong>{spec.label}</strong>
                <span class="fx-btns">
                  <button class="mini" aria-label={`${spec.label} on/off`} aria-pressed={fx.enabled !== false} onClick={() => run(setEffectEnabled(lid(), fx.id, fx.enabled === false))}>
                    {fx.enabled === false ? "Off" : "On"}
                  </button>
                  <button class="mini" aria-label={`Move ${spec.label} up`} disabled={i() === 0} onClick={() => run(moveEffect(lid(), fx.id, i() - 1))}>↑</button>
                  <button class="mini" aria-label={`Move ${spec.label} down`} disabled={i() >= count() - 1} onClick={() => run(moveEffect(lid(), fx.id, i() + 1))}>↓</button>
                  <button class="mini" aria-label={`Remove ${spec.label}`} onClick={() => run(removeEffect(lid(), fx.id))}>×</button>
                </span>
              </div>
              <Show when={spec.color}>
                <label class="swatch">
                  <span class="scrub-label">{spec.colorLabel ?? "Colour"}</span>
                  <input
                    type="color"
                    aria-label={`${spec.label} colour`}
                    value={rgbToHex(fx.color ?? spec.color!)}
                    onInput={(e) => {
                      const c = hexToRgba(e.currentTarget.value, (fx.color ?? spec.color!)[3]);
                      if (c) preview(setEffectColor(lid(), fx.id, c));
                    }}
                    onChange={(e) => {
                      const c = hexToRgba(e.currentTarget.value, (fx.color ?? spec.color!)[3]);
                      if (c) run(setEffectColor(lid(), fx.id, c));
                    }}
                  />
                </label>
              </Show>
              <div class="fx-params">
                <For each={spec.params}>
                  {(p) => {
                    const mul = p.mul ?? 1;
                    const cmd = (v: number) => setEffectValue(lid(), fx.id, p.key, v / mul, ctrl.time, ctrl.autoKey);
                    return (
                      <ScrubField
                        label={`${spec.label}: ${p.label}`}
                        value={() => (props.tick(), evalTrack(fx.values[p.key] ?? { keys: [] }, ctrl.time, p.def) * mul)}
                        perPx={p.perPx}
                        min={p.min * mul}
                        max={p.max * mul}
                        onPreview={(v) => preview(cmd(v))}
                        onCommit={(v) => run(cmd(v))}
                      />
                    );
                  }}
                </For>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
