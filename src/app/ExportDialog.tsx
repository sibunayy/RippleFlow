import { createSignal, For, Match, Show, Switch } from "solid-js";
import type { Composition } from "../core/types";
import { exportComposition, exportSize, PRESETS, type ExportPreset } from "../export/exportComposition";
import type { ExportSession } from "../video/videoLibrary";

type Phase =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; file: File; url: string; ms: number }
  | { kind: "failed"; message: string };

const mb = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

/**
 * Export flow: pick a preset, render, then a Save button. The share sheet needs a
 * fresh tap (Safari rejects share() long after the gesture), so saving is its own step.
 */
export function ExportDialog(props: { comp: () => Composition; bitmapOf: (asset: string) => ImageBitmap | undefined; videoSession: () => ExportSession; onClose: () => void }) {
  const [preset, setPreset] = createSignal<ExportPreset>(PRESETS[1]!);
  const [phase, setPhase] = createSignal<Phase>({ kind: "idle" });
  const [saveNote, setSaveNote] = createSignal<string | null>(null);
  const [compat, setCompat] = createSignal(false);
  let abort: AbortController | null = null;

  const supported = typeof VideoEncoder !== "undefined" && !!navigator.gpu;
  const size = () => exportSize(props.comp(), preset());
  const estimate = () => (preset().bitrate * props.comp().duration) / 8;

  const close = () => {
    abort?.abort();
    const p = phase();
    if (p.kind === "done") URL.revokeObjectURL(p.url);
    props.onClose();
  };

  const start = async () => {
    const comp = props.comp(); // immutable snapshot: edits made while exporting do not affect it
    abort = new AbortController();
    setSaveNote(null);
    setPhase({ kind: "running", done: 0, total: Math.round(preset().fps * comp.duration) });
    const session = props.videoSession();
    try {
      const r = await exportComposition(comp, {
        preset: preset(),
        pixelFormat: compat() ? "rgba" : "nv12",
        signal: abort.signal,
        bitmapOf: props.bitmapOf,
        videos: session,
        onProgress: (done, total) => setPhase({ kind: "running", done, total }),
      });
      const file = new File([r.blob], "rippleflow.mp4", { type: "video/mp4" });
      setPhase({ kind: "done", file, url: URL.createObjectURL(file), ms: r.wallMs });
    } catch (e) {
      if (abort.signal.aborted) setPhase({ kind: "idle" });
      else setPhase({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      await session.close();
    }
  };

  const save = async (file: File) => {
    setSaveNote(null);
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "RippleFlow export" });
        return;
      }
      setSaveNote("Sharing files is not supported here. Use Download.");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // user dismissed the sheet
      setSaveNote(`Could not open the share sheet (${e instanceof Error ? e.message : String(e)}). Use Download.`);
    }
  };

  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label="Export">
      <div class="sheet">
        <h2>Export video</h2>
        <Show when={!supported}>
          <p class="warn">This browser cannot encode video (WebCodecs or WebGPU missing).</p>
        </Show>
        <Switch>
          <Match when={phase().kind === "idle" || phase().kind === "failed"}>
            <div class="presets">
              <For each={PRESETS}>
                {(p) => (
                  <button classList={{ on: preset().id === p.id }} onClick={() => setPreset(p)}>
                    {p.label}
                  </button>
                )}
              </For>
            </div>
            <p>
              {size().width}×{size().height}, {props.comp().duration.toFixed(1)} s, up to about {mb(estimate())}. No audio.
            </p>
            <label class="compat">
              <input type="checkbox" checked={compat()} onChange={(e) => setCompat(e.currentTarget.checked)} /> Compatibility mode (use if the exported video looks garbled)
            </label>
            <Show when={(phase() as { message?: string }).message}>
              <p class="warn">Export failed: {(phase() as { message: string }).message}</p>
            </Show>
            <div class="row">
              <button onClick={close}>Close</button>
              <button class="primary" disabled={!supported} onClick={start}>
                Export
              </button>
            </div>
          </Match>
          <Match when={phase().kind === "running"}>
            {(() => {
              const p = () => phase() as { done: number; total: number };
              return (
                <>
                  <progress value={p().done} max={p().total} />
                  <p>
                    Frame {p().done} of {p().total}. Keep this screen open.
                  </p>
                  <div class="row">
                    <button onClick={() => abort?.abort()}>Cancel</button>
                  </div>
                </>
              );
            })()}
          </Match>
          <Match when={phase().kind === "done"}>
            {(() => {
              const d = () => phase() as { file: File; url: string; ms: number };
              return (
                <>
                  <p>
                    Done: {mb(d().file.size)} in {(d().ms / 1000).toFixed(1)} s.
                  </p>
                  <video src={d().url} controls playsinline muted class="preview" />
                  <Show when={saveNote()}>
                    <p class="warn">{saveNote()}</p>
                  </Show>
                  <div class="row">
                    <button onClick={close}>Close</button>
                    <a class="btn" href={d().url} download="rippleflow.mp4">
                      Download
                    </a>
                    <button class="primary" onClick={() => void save(d().file)}>
                      Save / Share
                    </button>
                  </div>
                </>
              );
            })()}
          </Match>
        </Switch>
      </div>
    </div>
  );
}
