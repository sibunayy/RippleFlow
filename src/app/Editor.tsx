import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { removeLayer } from "../core/commands";
import { EditorController, type PointerInput } from "../editor/controller";
import { MeshRenderer } from "../render/meshRenderer";
import { buildDraws, SceneSync, selectionCorners } from "./sceneDraws";
import { Autosaver, loadProject, type SaveState } from "../persist/autosave";
import { MemoryStore, OpfsStore, opfsAvailable, type ProjectStore } from "../persist/store";
import { addShape, nextLayerNumber, type ShapeKind } from "./shapes";
import type { KeyColumn } from "../editor/keyframeEdit";
import { Graph } from "./Graph";
import { Props } from "./Props";
import { registerServiceWorker } from "./pwa";
import { Timeline } from "./Timeline";

declare global {
  interface Window {
    __rf?: { ctrl: EditorController; renderer: MeshRenderer; frame: () => void; saver: Autosaver };
  }
}

export function Editor() {
  let canvas!: HTMLCanvasElement;
  let stage!: HTMLDivElement;
  const ctrl = new EditorController({ width: 1920, height: 1080, fps: 30, duration: 6, layers: [] });
  const [tick, setTick] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const [playing, setPlaying] = createSignal(false);
  const [picked, setPicked] = createSignal<KeyColumn | null>(null);
  const [saveState, setSaveState] = createSignal<SaveState | "unavailable">("saved");
  const [notice, setNotice] = createSignal<string | null>(null);
  const [update, setUpdate] = createSignal<(() => void) | null>(null);
  const store: ProjectStore = opfsAvailable() ? new OpfsStore() : new MemoryStore();
  const saver = new Autosaver({ store, id: "autosave", onState: (st) => setSaveState(st) });
  if (!opfsAvailable()) setSaveState("unavailable");
  let renderer: MeshRenderer | undefined;
  const sync = new SceneSync();
  let dirty = true;
  let raf = 0;
  let lastFrame = 0;
  // Debug only: the container's software GPU fails buffer readback while a rAF loop runs.
  const noloop = new URLSearchParams(location.search).has("noloop");

  const bump = () => {
    saver.touch(ctrl.document);
    dirty = true;
    setTick((n) => n + 1);
  };

  const frame = (now: number) => {
    if (!noloop) raf = requestAnimationFrame(frame);
    if (playing()) {
      const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
      const next = ctrl.time + dt;
      ctrl.setTime(next >= ctrl.document.duration ? 0 : next);
    }
    lastFrame = now;
    if (!dirty || !renderer) return;
    dirty = false;
    sync.sync(renderer, buildDraws(ctrl, devicePixelRatio));
    if (!noloop) renderer.render();
  };

  onMount(async () => {
    const unsub = ctrl.subscribe(bump);
    const hide = () => {
      if (document.visibilityState === "hidden") void saver.flush();
    };
    document.addEventListener("visibilitychange", hide);
    addEventListener("pagehide", hide);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", hide);
      removeEventListener("pagehide", hide);
    });
    void restore();
    registerServiceWorker((apply) => setUpdate(() => apply));
    const resize = () => {
      const r = stage.getBoundingClientRect();
      const first = canvas.width <= 300;
      canvas.width = Math.max(1, Math.round(r.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(r.height * devicePixelRatio));
      if (first) ctrl.fitView(r.width, r.height);
      bump();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    onCleanup(() => {
      unsub();
      ro.disconnect();
      cancelAnimationFrame(raf);
    });
    try {
      renderer = await MeshRenderer.create(canvas);
      renderer.clearColor = { r: 0.13, g: 0.13, b: 0.15, a: 1 };
      resize();
      if (new URLSearchParams(location.search).has("debug")) window.__rf = { ctrl, renderer, frame: () => frame(performance.now()), saver };
      if (!noloop) raf = requestAnimationFrame(frame);
      else frame(performance.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  async function restore() {
    try {
      const r = await loadProject(store, "autosave");
      if (r.kind === "ok") {
        saver.markSaved(r.doc);
        ctrl.replaceDocument(r.doc);
      } else if (r.kind === "corrupt") {
        // Keep the damaged text so it is not lost when the next edit overwrites the autosave.
        await store.save("autosave.corrupt", r.text);
        setNotice(`Your last project could not be read (${r.error.message}). A copy was kept as autosave.corrupt.`);
        saver.markSaved(ctrl.document);
      } else {
        saver.markSaved(ctrl.document);
      }
    } catch (e) {
      // Saving stays off: we could not read what is there, so we must not overwrite it.
      setSaveState("unavailable");
      setNotice(`Could not open saved work, so autosave is off: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const input = (e: PointerEvent): PointerInput => {
    const r = canvas.getBoundingClientRect();
    return {
      id: e.pointerId,
      type: e.pointerType === "pen" ? "pen" : e.pointerType === "touch" ? "touch" : "mouse",
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      shift: e.shiftKey,
    };
  };

  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    ctrl.pointerDown(input(e));
  };
  const onMove = (e: PointerEvent) => {
    // Use the coalesced samples so a fast Pencil stroke keeps its detail.
    const list = e.getCoalescedEvents?.() ?? [];
    for (const c of list.length ? list : [e]) ctrl.pointerMove(input(c));
  };
  const onUp = (e: PointerEvent) => ctrl.pointerUp(input(e));
  const onCancel = (e: PointerEvent) => ctrl.pointerCancel(input(e));

  const add = (kind: ShapeKind) => {
    const n = nextLayerNumber(ctrl.document.layers);
    const id = `layer-${n}`;
    ctrl.execute(addShape(kind, n, ctrl.document.width, ctrl.document.height));
    ctrl.setSelection(id);
  };
  const del = () => {
    const id = ctrl.selection;
    if (id) ctrl.execute(removeLayer(id));
  };

  const corners = () => (tick(), selectionCorners(ctrl));

  return (
    <div class="app">
      <header class="bar">
        <strong>RippleFlow</strong>
        <button onClick={() => add("rect")}>Rect</button>
        <button onClick={() => add("ellipse")}>Ellipse</button>
        <button onClick={() => add("star")}>Star</button>
        <button onClick={del} disabled={(tick(), ctrl.selection === null)}>Delete</button>
        <span class="sep" />
        <button onClick={() => ctrl.undo()} disabled={(tick(), !ctrl.canUndo)}>Undo</button>
        <button onClick={() => ctrl.redo()} disabled={(tick(), !ctrl.canRedo)}>Redo</button>
        <span class="sep" />
        <span class="save" classList={{ bad: saveState() === "error" || saveState() === "unavailable" }}>
          {({ saved: "Saved", saving: "Saving…", dirty: "Unsaved", error: "Save failed", unavailable: "Not saved: storage unavailable" } as const)[saveState()]}
        </span>
        <label>
          <input type="checkbox" onChange={(e) => (ctrl.autoKey = e.currentTarget.checked)} /> Auto-key
        </label>
      </header>
      <div class="stage" ref={stage}>
        <canvas
          ref={canvas}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
        />
        <svg class="overlay">
          <Show when={corners()}>
            {(c) => (
              <>
                <polygon points={c().map((p) => p.join(",")).join(" ")} class="sel" />
                {c().map(([x, y]) => (
                  <circle cx={x} cy={y} r="7" class="handle" />
                ))}
              </>
            )}
          </Show>
        </svg>
        <Graph ctrl={ctrl} tick={tick} picked={picked} />
        <Show when={update()}>
          {(apply) => (
            <p class="error notice update">
              A new version is ready.{" "}
              <button
                onClick={() => {
                  // Make sure the latest edit is on disk before the page reloads.
                  void saver.flush().finally(() => apply()());
                }}
              >
                Reload
              </button>
            </p>
          )}
        </Show>
        <Show when={notice()}>
          <p class="error notice" onClick={() => setNotice(null)}>{notice()}</p>
        </Show>
        <Show when={error()}>
          <p class="error">WebGPU unavailable: {error()}</p>
        </Show>
      </div>
      <Props ctrl={ctrl} tick={tick} />
      <Timeline ctrl={ctrl} tick={tick} picked={picked} setPicked={setPicked} />
      <footer class="bar">
        <button onClick={() => setPlaying(!playing())}>{playing() ? "Pause" : "Play"}</button>
        <input
          type="range"
          min="0"
          max={ctrl.document.duration}
          step="0.01"
          value={(tick(), ctrl.time)}
          onInput={(e) => ctrl.setTime(Number(e.currentTarget.value))}
        />
        <span class="time">{(tick(), ctrl.time.toFixed(2))}s</span>
      </footer>
    </div>
  );
}
