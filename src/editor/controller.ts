import { apply, invert, multiply, scale, translate, type Affine } from "../core/affine";
import { History, type Command } from "../core/history";
import { evaluateScene, type SceneItem } from "../core/scene";
import type { Composition, Id, VideoContent } from "../core/types";
import type { FrameRef } from "../video/videoLibrary";
import { buildImageGeometry, buildShapeGeometry, buildVideoGeometry, type ShapeGeometry } from "../geometry/layerGeometry";
import { TwoFingerGesture } from "../input/twoFingerGesture";
import { applyWorldDelta, transformLayer } from "./transformEdit";
import { SelectTool, type ToolContext, type ToolOutput } from "./selectTool";
import type { Bounds } from "./hitTest";

export interface PointerInput {
  readonly id: number;
  readonly type: "pen" | "mouse" | "touch";
  /** Screen (canvas CSS pixel) coordinates. */
  readonly x: number;
  readonly y: number;
  readonly shift?: boolean;
}

/**
 * Everything the editor UI needs, with no DOM or GPU: document + history,
 * playhead, selection, view, and pointer routing. Pen and mouse drive the
 * tool; touch navigates (two fingers pan/zoom/rotate). The UI subscribes and
 * redraws; it never edits the document directly.
 */
export class EditorController {
  private history: History;
  private readonly tool = new SelectTool();
  private readonly gesture = new TwoFingerGesture();
  private readonly geometry = new WeakMap<object, ShapeGeometry>();
  private listeners = new Set<() => void>();
  private preview: Composition | null = null;

  /** Playhead, seconds. */
  time = 0;
  /** When on, edits write a keyframe at the playhead. */
  autoKey = false;
  /** Composition to screen. */
  view: Affine = [1, 0, 0, 1, 0, 0];

  constructor(initial: Composition) {
    this.history = new History(initial);
  }

  /** Swap in a different document (opening a project): clears history, selection and any drag. */
  replaceDocument(doc: Composition): void {
    this.history = new History(doc);
    this.tool.cancel();
    this.tool.setSelection(null);
    this.preview = null;
    this.time = 0;
    this.emit();
  }

  /** The committed document. */
  get document(): Composition {
    return this.history.current;
  }
  /** What to draw: the document, or the in-progress drag. */
  get displayed(): Composition {
    return this.preview ?? this.history.current;
  }
  get selection(): Id | null {
    return this.tool.selection;
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.listeners.forEach((f) => f());
  }

  execute(cmd: Command): void {
    this.history.execute(cmd);
    this.fixSelection();
    this.emit();
  }
  undo(): void {
    this.history.undo();
    this.fixSelection();
    this.emit();
  }
  redo(): void {
    this.history.redo();
    this.fixSelection();
    this.emit();
  }
  setTime(t: number): void {
    this.time = Math.min(Math.max(t, 0), this.document.duration);
    this.emit();
  }
  setSelection(id: Id | null): void {
    this.tool.setSelection(id);
    this.emit();
  }

  /** Scene to draw (with any in-progress drag applied). */
  scene(): SceneItem[] {
    return evaluateScene(this.displayed, this.time);
  }

  /** Resolves a loaded picture by asset id. The app sets this; until a picture loads it returns undefined. */
  bitmapOf: (asset: string) => ImageBitmap | undefined = () => undefined;

  /** Local-space geometry for a layer. Shapes are built once per shape object; image layers are a cheap shared rectangle. */
  geometryOf(id: Id): ShapeGeometry | undefined {
    const layer = this.document.layers.find((l) => l.id === id);
    if (!layer) return undefined;
    if (layer.image) return buildImageGeometry(layer.image, this.bitmapOf(layer.image.asset));
    if (layer.video) return buildVideoGeometry(layer.video);
    const shape = layer.shape;
    if (!shape) return undefined;
    let g = this.geometry.get(shape);
    if (!g) {
      g = buildShapeGeometry(shape);
      this.geometry.set(shape, g);
    }
    return g;
  }

  /** Current decoded frame of a video layer at composition time `t`. The app sets this; it returns undefined until a frame has decoded. */
  frameOf: (video: VideoContent, t: number) => FrameRef | undefined = () => undefined;

  /** Tell the editor a picture finished loading so the view redraws. */
  notifyImagesChanged(): void {
    this.emit();
  }

  /** Centre the composition in a viewport, leaving `margin` px around it. */
  fitView(width: number, height: number, margin = 24): void {
    const { width: cw, height: ch } = this.document;
    const k = Math.min((width - 2 * margin) / cw, (height - 2 * margin) / ch);
    this.view = multiply(translate(width / 2, height / 2), multiply(scale(k), translate(-cw / 2, -ch / 2)));
    this.emit();
  }

  screenToComp(x: number, y: number): [number, number] {
    const inv = invert(this.view);
    return inv ? apply(inv, x, y) : [x, y];
  }

  pointerDown(p: PointerInput): void {
    if (p.type === "touch") {
      this.tool.cancel(); // a finger landing mid-drag means the user is navigating
      this.dropPreview();
      this.gesture.down(p.id, p.x, p.y);
      return;
    }
    this.route(this.tool.down(p.id, this.toolEvent(p), this.toolContext()));
  }

  pointerMove(p: PointerInput): void {
    if (p.type === "touch") {
      const delta = this.gesture.move(p.id, p.x, p.y);
      if (delta) {
        this.view = multiply(delta, this.view);
        this.emit();
      }
      return;
    }
    this.route(this.tool.move(p.id, this.toolEvent(p), this.toolContext()));
  }

  pointerUp(p: PointerInput): void {
    if (p.type === "touch") {
      this.gesture.up(p.id);
      return;
    }
    this.route(this.tool.up(p.id, this.toolEvent(p), this.toolContext()));
  }

  pointerCancel(p: PointerInput): void {
    if (p.type === "touch") this.gesture.up(p.id);
    else {
      this.tool.cancel();
      this.dropPreview();
      this.emit();
    }
  }

  private route(out: ToolOutput): void {
    if (out.drag) {
      const { id, delta, final, kind } = out.drag;
      if (final) {
        this.preview = null;
        this.execute(transformLayer(id, delta, this.time, this.autoKey, `${kind[0]!.toUpperCase()}${kind.slice(1)} layer`));
        return;
      }
      this.preview = applyWorldDelta(this.document, id, delta, this.time, this.autoKey);
    }
    if (out.drag || out.select !== undefined) this.emit();
  }

  private dropPreview(): void {
    this.preview = null;
  }

  private toolEvent(p: PointerInput) {
    const [x, y] = this.screenToComp(p.x, p.y);
    return { pointerType: p.type, x, y, shift: p.shift };
  }

  /** Tools always see the committed document, so drag deltas stay relative to the drag start. */
  private toolContext(): ToolContext {
    const k = Math.hypot(this.view[0], this.view[1]);
    return {
      items: evaluateScene(this.document, this.time),
      boundsOf: (id): Bounds | undefined => this.geometryOf(id)?.bounds,
      unitsPerPx: k > 0 ? 1 / k : 1,
    };
  }

  private fixSelection(): void {
    const sel = this.tool.selection;
    if (sel !== null && !this.document.layers.some((l) => l.id === sel)) this.tool.setSelection(null);
  }
}
