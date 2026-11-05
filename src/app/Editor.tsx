import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Composition } from "../core/types";
import { removeLayer, renameComposition } from "../core/commands";
import { EditorController, type PointerInput } from "../editor/controller";
import { MeshRenderer } from "../render/meshRenderer";
import { buildDraws, SceneSync, selectionCorners } from "./sceneDraws";
import { Autosaver, loadProject, type SaveState } from "../persist/autosave";
import { blankProject, duplicateProject, LEGACY_ID, listProjects, newProjectId, recallCurrent, rememberCurrent, untitledName } from "../persist/projects";
import { unpackBundle } from "../persist/bundle";
import { ProjectsDialog } from "./ProjectsDialog";
import { MemoryStore, OpfsStore, opfsAvailable, type ProjectStore } from "../persist/store";
import { ImageLibrary } from "./images";
import { VideoLibrary, type VideoMode } from "../video/videoLibrary";
import { MemoryAssets, OpfsAssets, type AssetStore } from "../persist/assets";
import { serialize } from "../persist/serialize";
import { addLayer, sequence, setDuration } from "../core/commands";
import { addShape, newNullLayer, newImageLayer, newVideoLayer, nextLayerNumber, type ShapeKind } from "./shapes";
import type { KeyColumn } from "../editor/keyframeEdit";
import { ExportDialog } from "./ExportDialog";
import { Graph } from "./Graph";
import { Props } from "./Props";
import { Style } from "./Style";
import { registerServiceWorker } from "./pwa";
import { Timeline } from "./Timeline";

declare global {
  interface Window {
    __rf?: { ctrl: EditorController; renderer: MeshRenderer; frame: () => void; readonly saver: Autosaver; images: ImageLibrary; videos: VideoLibrary };
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
  const [exporting, setExporting] = createSignal(false);
  const [projectsOpen, setProjectsOpen] = createSignal(false);
  const [styleOpen, setStyleOpen] = createSignal(true);
  const [projectId, setProjectId] = createSignal(LEGACY_ID);
  const [update, setUpdate] = createSignal<(() => void) | null>(null);
  const store: ProjectStore = opfsAvailable() ? new OpfsStore() : new MemoryStore();
  const images = new ImageLibrary(opfsAvailable() ? new OpfsAssets() : new MemoryAssets(), () => {
    ctrl.notifyImagesChanged();
    const bad = images.failed().length;
    if (bad > 0) setNotice(`${bad} picture${bad === 1 ? "" : "s"} could not be loaded and show as grey boxes.`);
  });
  ctrl.bitmapOf = (asset) => images.bitmapOf(asset);
  // "external" is the fast path measured on the iPad. "bitmap" exists for environments without external textures (the test container).
  const videoMode: VideoMode = new URLSearchParams(location.search).get("videoMode") === "bitmap" ? "bitmap" : "external";
  const videos = new VideoLibrary(
    opfsAvailable() ? new OpfsAssets() : new MemoryAssets(),
    () => {
      ctrl.notifyImagesChanged();
      const bad = videos.failed().length;
      if (bad > 0) setNotice(`${bad} video${bad === 1 ? "" : "s"} could not be opened. Export would skip them.`);
    },
    videoMode,
  );
  ctrl.frameOf = (video, t) => videos.frameOf(video, t);
  let videoInput!: HTMLInputElement;
  const importVideos = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try {
        const start = Math.round(ctrl.time * ctrl.document.fps) / ctrl.document.fps;
        const content = await videos.import(file, start);
        const n = nextLayerNumber(ctrl.document.layers);
        const layer = newVideoLayer(n, file.name.replace(/\.[^.]+$/, "") || `Video ${n}`, content, ctrl.document.width, ctrl.document.height, Math.max(ctrl.document.duration, start + content.duration));
        // A clip longer than the composition extends it, so nothing is silently cut off.
        const needed = Math.ceil((start + content.duration) * 10) / 10;
        ctrl.execute(sequence(`Add video ${layer.name}`, [...(needed > ctrl.document.duration ? [setDuration(needed)] : []), addLayer(layer)]));
        ctrl.setSelection(layer.id);
      } catch (e) {
        setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    videoInput.value = "";
  };
  let fileInput!: HTMLInputElement;
  const importFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try {
        const content = await images.import(file);
        const n = nextLayerNumber(ctrl.document.layers);
        ctrl.execute(addLayer(newImageLayer(n, file.name.replace(/\.[^.]+$/, "") || `Image ${n}`, content, ctrl.document.width, ctrl.document.height)));
        ctrl.setSelection(`layer-${n}`);
      } catch (e) {
        setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    fileInput.value = ""; // allow picking the same file again
  };
  const assetStore: AssetStore = opfsAvailable() ? new OpfsAssets() : new MemoryAssets();
  const makeSaver = (id: string) => new Autosaver({ store, id, onState: (st) => setSaveState(st) });
  let saver = makeSaver(LEGACY_ID);
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
      if (new URLSearchParams(location.search).has("debug")) window.__rf = { ctrl, renderer, frame: () => frame(performance.now()), get saver() { return saver; }, images, videos, openProject, newProject } as unknown as NonNullable<typeof window.__rf>;
      if (!noloop) raf = requestAnimationFrame(frame);
      else frame(performance.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  /** Switch to another stored project. The current one is written first. */
  async function openProject(id: string) {
    await saver.flush();
    setSaveState("saved");
    const r = await loadProject(store, id);
    saver.stop();
    saver = makeSaver(id);
    if (r.kind === "ok") {
      saver.markSaved(r.doc);
      ctrl.replaceDocument(r.doc);
      setPicked(null);
    } else if (r.kind === "corrupt") {
      // Keep the damaged text so it is not lost when the next edit overwrites it.
      await store.save(`${id}.corrupt`, r.text);
      setNotice(`That project could not be read (${r.error.message}). A copy was kept as ${id}.corrupt.`);
      saver.markSaved(ctrl.document);
      return;
    } else {
      saver.markSaved(ctrl.document);
    }
    setProjectId(id);
    rememberCurrent(id);
  }

  async function createProject(name?: string, doc?: Composition) {
    await saver.flush();
    const names = (await listProjects(store)).map((p) => p.name);
    const id = newProjectId();
    const d = doc ?? blankProject(name ?? untitledName(names));
    await store.save(id, serialize(d)); // saved at once so it shows in the list
    saver.stop();
    saver = makeSaver(id);
    saver.markSaved(d);
    ctrl.replaceDocument(d);
    setPicked(null);
    setProjectId(id);
    rememberCurrent(id);
  }
  const newProject = () => createProject();

  async function restore() {
    try {
      const all = await listProjects(store);
      const remembered = recallCurrent();
      const pick = all.find((p) => p.id === remembered && !p.broken) ?? all.find((p) => !p.broken);
      if (pick) {
        const r = await loadProject(store, pick.id);
        if (r.kind === "ok") {
          saver = makeSaver(pick.id);
          saver.markSaved(r.doc);
          ctrl.replaceDocument(r.doc);
          setProjectId(pick.id);
          rememberCurrent(pick.id);
          return;
        }
      }
      if (all.some((p) => p.broken)) setNotice("Some saved projects could not be read. Open Projects to delete them.");
      await createProject();
    } catch (e) {
      // Saving stays off: we could not read what is there, so we must not overwrite it.
      saver.stop();
      setSaveState("unavailable");
      setNotice(`Could not open saved work, so autosave is off: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function importBundle(file: File) {
    const { comp, assets } = await unpackBundle(file);
    for (const a of assets) if (!(await assetStore.has(a.id))) await assetStore.put(a.id, a.blob);
    const names = (await listProjects(store)).map((p) => p.name);
    const name = comp.name && !names.includes(comp.name) ? comp.name : `${comp.name ?? "Imported"} (restored)`;
    await createProject(name, { ...comp, name });
    setProjectsOpen(false);
  }

  async function deleteProject(id: string) {
    if (id !== projectId()) {
      await store.remove(id);
      return;
    }
    saver.stop();
    await store.remove(id);
    const rest = (await listProjects(store)).find((p) => !p.broken);
    if (rest) await openProject(rest.id);
    else await createProject();
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
  const addNull = () => {
    const layer = newNullLayer(nextLayerNumber(ctrl.document.layers), ctrl.document.width, ctrl.document.height);
    ctrl.execute(addLayer(layer));
    ctrl.setSelection(layer.id);
  };
  const del = () => {
    const id = ctrl.selection;
    if (id) ctrl.execute(removeLayer(id));
  };

  const corners = () => (tick(), ctrl.pointEdit && ctrl.nodeOverlay() ? null : selectionCorners(ctrl));
  const nodeView = () => (tick(), ctrl.nodeOverlay());
  const penView = () => (tick(), ctrl.penOverlay());
  const penning = () => (tick(), ctrl.penTarget !== null);
  const canEditPoints = () => (tick(), !!ctrl.document.layers.find((l) => l.id === ctrl.selection)?.shape);

  return (
    <div class="app">
      <header class="bar">
        <button class="proj" title="Projects" onClick={() => { setPlaying(false); setProjectsOpen(true); }}>{(tick(), ctrl.document.name ?? "Project")} ▾</button>
        <button onClick={() => add("rect")}>Rect</button>
        <button onClick={() => add("ellipse")}>Ellipse</button>
        <button onClick={() => add("star")}>Star</button>
        <button onClick={addNull}>Null</button>
        <button onClick={() => fileInput.click()}>Image</button>
        <button onClick={() => videoInput.click()}>Video</button>
        <input ref={videoInput} type="file" accept="video/*,.mov,.mp4,.m4v" hidden onChange={(e) => void importVideos(e.currentTarget.files)} />
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => void importFiles(e.currentTarget.files)} />
        <button onClick={del} disabled={(tick(), ctrl.selection === null)}>Delete</button>
        <span class="sep" />
        <button onClick={() => ctrl.undo()} disabled={(tick(), !ctrl.canUndo)}>Undo</button>
        <button onClick={() => ctrl.redo()} disabled={(tick(), !ctrl.canRedo)}>Redo</button>
        <span class="sep" />
        <button classList={{ on: penning() }} aria-pressed={penning()} onClick={() => (penning() ? ctrl.cancelPen() : ctrl.startPen({ kind: "shape" }))}>Pen</button>
        <button classList={{ on: (tick(), ctrl.pointEdit) }} aria-pressed={(tick(), ctrl.pointEdit)} disabled={!canEditPoints()} onClick={() => ctrl.setPointEdit(!ctrl.pointEdit)}>Points</button>
        <button classList={{ on: styleOpen() }} aria-pressed={styleOpen()} onClick={() => setStyleOpen(!styleOpen())}>Style</button>
        <button onClick={() => { setPlaying(false); setExporting(true); }}>Export</button>
        <span class="build" title="Build">{typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"}</span>
        <span class="save" classList={{ bad: saveState() === "error" || saveState() === "unavailable" }}>
          {({ saved: "Saved", saving: "Saving…", dirty: "Unsaved", error: "Save failed", unavailable: "Not saved: storage unavailable" } as const)[saveState()]}
        </span>
        <label>
          <input type="checkbox" onChange={(e) => (ctrl.autoKey = e.currentTarget.checked)} /> Auto-key
        </label>
      </header>
      <div class="workspace">
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
          <Show when={penView()}>
            {(v) => (
              <>
                <path d={v().d} class="pen-path" />
                {v().handles.map((h) => (
                  <>
                    <line x1={h.fromX} y1={h.fromY} x2={h.x} y2={h.y} class="node-arm" />
                    <circle cx={h.x} cy={h.y} r="7" class="node-handle" />
                  </>
                ))}
                {v().nodes.map((n) => (
                  <rect x={n.x - 6} y={n.y - 6} width="12" height="12" class="node" classList={{ selected: n.first }} />
                ))}
              </>
            )}
          </Show>
          <Show when={nodeView()}>
            {(v) => (
              <>
                {v().handles.map((h) => (
                  <>
                    <line x1={h.fromX} y1={h.fromY} x2={h.x} y2={h.y} class="node-arm" />
                    <circle cx={h.x} cy={h.y} r="7" class="node-handle" />
                  </>
                ))}
                {v().nodes.map((n) => (
                  <rect x={n.x - 6} y={n.y - 6} width="12" height="12" class="node" classList={{ selected: n.selected }} />
                ))}
              </>
            )}
          </Show>
        </svg>
        <Show when={penning()}>
          <div class="nodebar">
            <button disabled={(tick(), ctrl.penPoints === 0)} onClick={() => ctrl.undoPenPoint()}>Undo point</button>
            <button disabled={(tick(), ctrl.penPoints < 2)} onClick={() => ctrl.finishPen(false)}>Done</button>
            <button disabled={(tick(), ctrl.penPoints < 3)} onClick={() => ctrl.finishPen(true)}>Close</button>
            <button onClick={() => ctrl.cancelPen()}>Cancel</button>
            <span class="hint">{(tick(), ctrl.penTarget?.kind === "mask" ? "Drawing a mask: tap points, drag for curves" : "Tap points, drag for curves, tap the first point to close")}</span>
          </div>
        </Show>
        <Show when={nodeView()}>
          <div class="nodebar">
            <button disabled={(tick(), ctrl.selectedNodeSmooth() === null)} onClick={() => ctrl.nodeAction("smooth")} classList={{ on: (tick(), ctrl.selectedNodeSmooth() === true) }}>Smooth</button>
            <button disabled={(tick(), ctrl.selectedNodeSmooth() === null)} onClick={() => ctrl.nodeAction("corner")}>Corner</button>
            <button disabled={(tick(), ctrl.selectedNodeSmooth() === null)} onClick={() => ctrl.nodeAction("delete")}>Delete point</button>
            <span class="hint">Tap the outline to add a point</span>
          </div>
        </Show>
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
      <Style ctrl={ctrl} tick={tick} notify={setNotice} open={styleOpen} />
      </div>
      <Show when={projectsOpen()}>
        <ProjectsDialog
          store={store}
          assets={assetStore}
          currentId={projectId()}
          comp={() => (tick(), ctrl.document)}
          flush={() => saver.flush()}
          onRename={(n) => ctrl.execute(renameComposition(n))}
          onOpen={(id) => void openProject(id).then(() => setProjectsOpen(false))}
          onNew={() => void createProject().then(() => setProjectsOpen(false))}
          onDuplicate={async (id) => {
            await saver.flush();
            const all = await listProjects(store);
            const base = all.find((p) => p.id === id)?.name ?? "Project";
            let name = `${base} copy`;
            for (let n = 2; all.some((p) => p.name === name); n++) name = `${base} copy ${n}`;
            await duplicateProject(store, id, name);
          }}
          onDelete={deleteProject}
          onImport={importBundle}
          onClose={() => setProjectsOpen(false)}
        />
      </Show>
      <Show when={exporting()}>
        <ExportDialog comp={() => ctrl.document} bitmapOf={(a) => images.bitmapOf(a)} videoSession={() => videos.exportSession()} onClose={() => setExporting(false)} />
      </Show>
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
