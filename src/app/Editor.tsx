import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { Composition } from "../core/types";
import { duplicateLayer, removeLayer, renameComposition } from "../core/commands";
import { EditorController, type PointerInput } from "../editor/controller";
import { MeshRenderer } from "../render/meshRenderer";
import { buildDraws, SceneSync, selectionCorners } from "./sceneDraws";
import { Autosaver, loadProject, type SaveState } from "../persist/autosave";
import { blankProject, duplicateProject, LEGACY_ID, listProjects, newProjectId, recallCurrent, rememberCurrent, untitledName } from "../persist/projects";
import { unpackBundle } from "../persist/bundle";
import { CompSettings } from "./CompSettings";
import { ProjectsDialog } from "./ProjectsDialog";
import { MemoryStore, OpfsStore, opfsAvailable, type ProjectStore } from "../persist/store";
import { ImageLibrary } from "./images";
import { VideoLibrary, type VideoMode } from "../video/videoLibrary";
import { MemoryAssets, OpfsAssets, type AssetStore } from "../persist/assets";
import { serialize } from "../persist/serialize";
import { addLayer, sequence, setDuration } from "../core/commands";
import { importSvg } from "../geometry/svgImport";
import { addShape, newNullLayer, newTextLayer, newImageLayer, newSvgLayers, newVideoLayer, nextLayerNumber, MORE_SHAPES, type ShapeKind } from "./shapes";
import type { KeyColumn } from "../editor/keyframeEdit";
import { ExportDialog } from "./ExportDialog";
import { Icon, Logo, type IconName } from "./icons";
import { Inspector, type InspectorTab } from "./Inspector";
import { registerServiceWorker } from "./pwa";
import { Timeline } from "./Timeline";
import "@fontsource/schibsted-grotesk/latin-400.css";
import "@fontsource/schibsted-grotesk/latin-500.css";
import "@fontsource/schibsted-grotesk/latin-600.css";
import "@fontsource/schibsted-grotesk/latin-700.css";
import "@fontsource/newsreader/latin-500-italic.css";
import "@fontsource/dm-mono/latin-400.css";
import "@fontsource/dm-mono/latin-500.css";

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
  const [compOpen, setCompOpen] = createSignal(false);
  const [tab, setTab] = createSignal<InspectorTab>("transform");
  const [inspCollapsed, setInspCollapsed] = createSignal(false);
  const [fly, setFly] = createSignal<{ kind: "shapes" | "media"; left: number; top: number } | null>(null);
  const [tlH, setTlH] = createSignal(320);
  let tlStart: number | null = null;
  const resizeTimeline = (dy: number, done: boolean) => {
    if (tlStart === null) tlStart = tlH();
    setTlH(Math.round(Math.min(Math.max(tlStart + dy, 150), innerHeight * 0.6)));
    if (done) tlStart = null;
  };
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
  let svgInput!: HTMLInputElement;
  const importSvgFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try {
        const svg = importSvg(await file.text());
        const n = nextLayerNumber(ctrl.document.layers);
        const layers = newSvgLayers(n, file.name.replace(/\.[^.]+$/, "") || `SVG ${n}`, svg, ctrl.document.width, ctrl.document.height);
        if (layers.length === 0) throw new Error("nothing drawable in this file");
        ctrl.execute(sequence(`Import ${file.name}`, layers.map((l) => addLayer(l))));
        ctrl.setSelection(layers[0]!.id);
        if (svg.skipped.length) setNotice(`Imported ${layers.length - 1} shapes. Not supported, left out: ${svg.skipped.join(", ")}.`);
      } catch (e) {
        setNotice(`Could not import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    svgInput.value = "";
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
      // Transparent around the composition, so the stage's dot grid shows through.
      renderer.clearColor = { r: 0, g: 0, b: 0, a: 0 };
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
  const addText = () => {
    const layer = newTextLayer(nextLayerNumber(ctrl.document.layers), "Hello", ctrl.document.width, ctrl.document.height);
    if (!layer) return setNotice("Text could not be created: the font is not loaded.");
    ctrl.execute(addLayer(layer));
    ctrl.setSelection(layer.id);
    setTab("style");
    setInspCollapsed(false);
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
  const pinView = () => (tick(), ctrl.pinOverlay());
  const selected = () => (tick(), ctrl.document.layers.find((l) => l.id === ctrl.selection));
  const canPin = () => !!selected()?.image;
  const penning = () => (tick(), ctrl.penTarget !== null);
  const canEditPoints = () => {
    const l = selected();
    return !!l?.shape && !l.text;
  };
  /** Select is "on" when no other mode (pen, points, pins) is running. */
  const selecting = () => (tick(), !penning() && !ctrl.pointEdit && !ctrl.pinMode);
  const toSelect = () => {
    if (ctrl.penTarget) ctrl.cancelPen();
    if (ctrl.pointEdit) ctrl.setPointEdit(false);
    if (ctrl.pinMode) ctrl.setPinMode(false);
    setFly(null);
  };
  const dup = () => {
    const id = ctrl.selection;
    if (!id) return;
    const newId = `layer-${nextLayerNumber(ctrl.document.layers)}`;
    ctrl.execute(duplicateLayer(id, newId));
    ctrl.setSelection(newId);
  };
  const openFly = (kind: "shapes" | "media", e: MouseEvent) => {
    if (fly()?.kind === kind) return setFly(null);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFly({ kind, left: r.right + 10, top: Math.min(r.top, innerHeight - (kind === "shapes" ? 560 : 240)) });
  };
  const flyPick = (fn: () => void) => () => {
    setFly(null);
    toSelect();
    fn();
  };
  const zoomPct = () => (tick(), Math.round(Math.hypot(ctrl.view[0], ctrl.view[1]) * 100));
  const fit = () => {
    const r = stage.getBoundingClientRect();
    ctrl.fitView(r.width, r.height);
  };
  const saveLabel = () => ({ saved: "Saved", saving: "Saving…", dirty: "Unsaved", error: "Save failed", unavailable: "Not saved: storage unavailable" } as const)[saveState()];

  const RailBtn = (p: { icon: IconName; label: string; on?: boolean; flyout?: boolean; onClick: (e: MouseEvent) => void }) => (
    <button type="button" class="tool" aria-pressed={!!p.on} aria-haspopup={p.flyout ? "menu" : undefined} onClick={p.onClick}>
      <Icon name={p.icon} size={24} />
      <span>{p.label}</span>
      <Show when={p.flyout}>
        <span class="fly-mark" aria-hidden="true" />
      </Show>
    </button>
  );
  const BarBtn = (p: { icon?: IconName; label: string; tone?: "danger" | "geo"; on?: boolean; disabled?: boolean; onClick: () => void }) => (
    <button type="button" classList={{ danger: p.tone === "danger", geo: p.tone === "geo", on: !!p.on }} aria-pressed={p.on === undefined ? undefined : p.on} disabled={p.disabled} onClick={p.onClick}>
      <Show when={p.icon}>
        <span class="bar-ico">
          <Icon name={p.icon!} />
        </span>
      </Show>
      {p.label}
    </button>
  );
  const ModeBar = (p: { hint: string; children: JSX.Element }) => (
    <div class="float-bar-wrap">
      <span class="float-hint">{p.hint}</span>
      <div class="float-bar" role="toolbar" aria-label="Edit mode">
        {p.children}
      </div>
    </div>
  );

  return (
    <div class="app" classList={{ "insp-collapsed": inspCollapsed() }} style={{ "--tl-h": `${tlH()}px` }}>
      <header class="topbar">
        <button type="button" class="proj" aria-label="Projects" onClick={() => { setPlaying(false); setProjectsOpen(true); }}>
          <Logo />
          <span class="proj-name">{(tick(), ctrl.document.name ?? "Project")}</span>
          <Icon name="chevron" size={18} class="dim" />
        </button>
        <span class="save" classList={{ bad: saveState() === "error" || saveState() === "unavailable", busy: saveState() === "saving" || saveState() === "dirty" }}>
          <span class="dot" aria-hidden="true" />
          {saveLabel()}
        </span>
        <span class="build" title="Build">{typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"}</span>
        <span class="spacer" />
        <button type="button" class="comp-btn" aria-label="Composition settings" onClick={() => { setPlaying(false); setCompOpen(true); }}>
          <span class="hi">{(tick(), `${ctrl.document.width}×${ctrl.document.height}`)}</span>
          <span>{(tick(), `${ctrl.document.fps} fps`)}</span>
          <span>{(tick(), `${ctrl.document.duration.toFixed(1)} s`)}</span>
        </button>
        <button type="button" class="round" aria-label="Undo" onClick={() => ctrl.undo()} disabled={(tick(), !ctrl.canUndo)}>
          <Icon name="undo" />
        </button>
        <button type="button" class="round" aria-label="Redo" onClick={() => ctrl.redo()} disabled={(tick(), !ctrl.canRedo)}>
          <Icon name="undo" style={{ transform: "scaleX(-1)" }} />
        </button>
        <button type="button" class="export" onClick={() => { setPlaying(false); setExporting(true); }}>Export</button>
        <input ref={svgInput} type="file" accept=".svg,image/svg+xml" hidden onChange={(e) => void importSvgFiles(e.currentTarget.files)} />
        <input ref={videoInput} type="file" accept="video/*,.mov,.mp4,.m4v" hidden onChange={(e) => void importVideos(e.currentTarget.files)} />
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => void importFiles(e.currentTarget.files)} />
      </header>
      <nav class="rail" aria-label="Tools">
        <RailBtn icon="select" label="Select" on={selecting()} onClick={toSelect} />
        <RailBtn icon="shapes" label="Shapes" flyout on={fly()?.kind === "shapes"} onClick={(e) => openFly("shapes", e)} />
        <RailBtn icon="pen" label="Pen" on={penning()} onClick={() => { setFly(null); if (penning()) ctrl.cancelPen(); else { toSelect(); ctrl.startPen({ kind: "shape" }); } }} />
        <RailBtn icon="text" label="Text" onClick={() => { toSelect(); addText(); }} />
        <RailBtn icon="media" label="Media" flyout on={fly()?.kind === "media"} onClick={(e) => openFly("media", e)} />
        <RailBtn icon="null" label="Null" onClick={() => { toSelect(); addNull(); }} />
      </nav>
      <Show when={fly()}>
        {(f) => (
          <>
            <div class="scrim" onPointerDown={() => setFly(null)} />
            <div class="flyout" role="menu" aria-label={f().kind === "shapes" ? "Shapes" : "Media"} style={{ left: `${f().left}px`, top: `${Math.max(8, f().top)}px` }}>
              <Show
                when={f().kind === "shapes"}
                fallback={
                  <>
                    <button type="button" role="menuitem" onClick={flyPick(() => fileInput.click())}>Image</button>
                    <button type="button" role="menuitem" onClick={flyPick(() => videoInput.click())}>Video</button>
                    <button type="button" role="menuitem" title="Import an SVG as editable shapes" onClick={flyPick(() => svgInput.click())}>SVG</button>
                  </>
                }>
                <button type="button" role="menuitem" onClick={flyPick(() => add("rect"))}>Rect</button>
                <button type="button" role="menuitem" onClick={flyPick(() => add("ellipse"))}>Ellipse</button>
                <button type="button" role="menuitem" onClick={flyPick(() => add("star"))}>Star</button>
                <For each={MORE_SHAPES}>{(m) => <button type="button" role="menuitem" onClick={flyPick(() => add(m.kind))}>{m.label}</button>}</For>
              </Show>
            </div>
          </>
        )}
      </Show>
      <main class="stage" ref={stage}>
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
                <polygon points={c().map((p) => p.join(",")).join(" ")} class="sel-under" />
                <polygon points={c().map((p) => p.join(",")).join(" ")} class="sel" />
                {c().map(([x, y]) => (
                  <circle cx={x} cy={y} r="8" class="handle" />
                ))}
              </>
            )}
          </Show>
          <Show when={pinView()}>
            {(v) => (
              <>
                {v().map((p) => (
                  <circle cx={p.x} cy={p.y} r="11" class="pin" classList={{ selected: p.selected }} />
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
          <ModeBar hint={(tick(), ctrl.penTarget?.kind === "mask" ? "Drawing a mask: tap points, drag for curves" : "Tap points, drag for curves, tap the first point to close")}>
            <BarBtn label="Undo point" disabled={(tick(), ctrl.penPoints === 0)} onClick={() => ctrl.undoPenPoint()} />
            <BarBtn label="Close" tone="geo" disabled={(tick(), ctrl.penPoints < 3)} onClick={() => ctrl.finishPen(true)} />
            <BarBtn label="Done" disabled={(tick(), ctrl.penPoints < 2)} onClick={() => ctrl.finishPen(false)} />
            <span class="bar-sep" />
            <BarBtn label="Cancel" tone="danger" onClick={() => ctrl.cancelPen()} />
          </ModeBar>
        </Show>
        <Show when={!penning() && nodeView()}>
          <ModeBar hint="Tap a point to select it, tap the outline to add one">
            <BarBtn label="Smooth" tone="geo" on={(tick(), ctrl.selectedNodeSmooth() === true)} disabled={(tick(), ctrl.selectedNodeSmooth() === null)} onClick={() => ctrl.nodeAction("smooth")} />
            <BarBtn label="Corner" disabled={(tick(), ctrl.selectedNodeSmooth() === null)} onClick={() => ctrl.nodeAction("corner")} />
            <BarBtn label="Delete point" tone="danger" disabled={(tick(), ctrl.selectedNodeSmooth() === null)} onClick={() => ctrl.nodeAction("delete")} />
            <span class="bar-sep" />
            <BarBtn label="Done" onClick={() => ctrl.setPointEdit(false)} />
          </ModeBar>
        </Show>
        <Show when={!penning() && pinView()}>
          <ModeBar hint="Tap the picture to pin, drag a pin to pull. Auto-key records it.">
            <BarBtn label="Delete pin" tone="danger" disabled={(tick(), ctrl.selectedPin === null)} onClick={() => ctrl.deleteSelectedPin()} />
            <span class="bar-sep" />
            <BarBtn label="Done" onClick={() => ctrl.setPinMode(false)} />
          </ModeBar>
        </Show>
        <Show when={selecting() && selected()}>
          {(l) => (
            <div class="float-bar-wrap">
              <div class="float-bar" role="toolbar" aria-label="Selected layer">
                <BarBtn icon="duplicate" label="Duplicate" onClick={dup} />
                <BarBtn icon="trash" label="Delete" tone="danger" onClick={del} />
                <Show when={canEditPoints() || canPin() || !!l().text}>
                  <span class="bar-sep" />
                </Show>
                <Show when={canEditPoints()}>
                  <BarBtn icon="points" label="Edit points" tone="geo" onClick={() => ctrl.setPointEdit(true)} />
                </Show>
                <Show when={canPin()}>
                  <BarBtn icon="pin" label="Pin warp" tone="geo" onClick={() => ctrl.setPinMode(true)} />
                </Show>
                <Show when={!!l().text}>
                  <BarBtn icon="text" label="Edit text" tone="geo" onClick={() => { setTab("style"); setInspCollapsed(false); }} />
                </Show>
              </div>
            </div>
          )}
        </Show>
        <button type="button" class="zoom-pill" aria-label={`Zoom ${zoomPct()}%, fit to screen`} onClick={fit}>
          {zoomPct()}%
        </button>
        <Show when={inspCollapsed()}>
          <button type="button" class="icon-btn insp-reopen" aria-label="Show inspector" onClick={() => setInspCollapsed(false)}>
            <Icon name="panel" />
          </button>
        </Show>
        <div class="notices">
          <Show when={update()}>
            {(apply) => (
              <p class="notice update">
                A new version is ready.
                <button
                  type="button"
                  onClick={() => {
                    // Make sure the latest edit is on disk before the page reloads.
                    void saver.flush().finally(() => apply()());
                  }}>
                  Reload
                </button>
              </p>
            )}
          </Show>
          <Show when={notice()}>
            <p class="notice" onClick={() => setNotice(null)}>{notice()}</p>
          </Show>
          <Show when={error()}>
            <p class="notice error">WebGPU unavailable: {error()}</p>
          </Show>
        </div>
      </main>
      <Inspector ctrl={ctrl} tick={tick} notify={setNotice} tab={tab} setTab={(t) => { setTab(t); setInspCollapsed(false); }} collapsed={inspCollapsed} onToggle={() => setInspCollapsed(!inspCollapsed())} />
      <Timeline ctrl={ctrl} tick={tick} picked={picked} setPicked={setPicked} playing={playing} setPlaying={setPlaying} onResize={resizeTimeline} />
      <Show when={compOpen()}>
        <CompSettings
          comp={() => (tick(), ctrl.document)}
          run={(cmd) => {
            try {
              const { width, height } = ctrl.document;
              ctrl.execute(cmd);
              if (ctrl.document.width !== width || ctrl.document.height !== height) fit();
              bump();
            } catch (e) {
              setNotice(e instanceof Error ? e.message : String(e));
            }
          }}
          onClose={() => setCompOpen(false)}
        />
      </Show>
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
    </div>
  );
}
