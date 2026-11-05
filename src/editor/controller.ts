import { apply, invert, maxScale, multiply, scale, translate, type Affine } from "../core/affine";
import { History, type Command } from "../core/history";
import { evaluateScene, type SceneItem } from "../core/scene";
import type { Composition, Id, Mask, VideoContent } from "../core/types";
import type { Mesh } from "../geometry/mesh";
import { tessellateFill } from "../geometry/fill";
import { flatten } from "../geometry/path";
import { parseSvgPath } from "../geometry/svgPath";
import type { FrameRef } from "../video/videoLibrary";
import { buildImageGeometry, buildLayerGeometry, buildVideoGeometry, type ShapeGeometry } from "../geometry/layerGeometry";
import { TwoFingerGesture } from "../input/twoFingerGesture";
import { applyWorldDelta, transformLayer } from "./transformEdit";
import { addLayer, addMask, editShape, patchMask } from "../core/commands";
import { newPathLayer, nextLayerNumber } from "../app/shapes";
import { newMask } from "./maskEdit";
import { PenTool } from "./penTool";
import { deleteNode, isSmooth, nodesToPath, parseNodes, setCorner, setSmooth, transformPath, type NodePath } from "../geometry/nodes";
import { NodeTool, type NodeContext, type NodeOutput, type NodeSel } from "./nodeTool";
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

export type PenTarget = { kind: "shape" } | { kind: "mask"; layerId: Id };

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
  private readonly masks = new WeakMap<object, Mesh>();
  private listeners = new Set<() => void>();
  private preview: Composition | null = null;
  private readonly nodeTool = new NodeTool();
  private pointEditOn = false;
  private pointMaskId: string | null = null;
  private readonly pen = new PenTool();
  private penTargetState: PenTarget | null = null;
  private parsed: { d: string; paths: NodePath[] } | null = null;

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
    this.nodeTool.cancel();
    this.nodeTool.setSelection(null);
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
    this.nodeTool.setSelection(null);
    this.history.undo();
    this.fixSelection();
    this.emit();
  }
  redo(): void {
    this.nodeTool.setSelection(null);
    this.history.redo();
    this.fixSelection();
    this.emit();
  }
  setTime(t: number): void {
    this.time = Math.min(Math.max(t, 0), this.document.duration);
    this.emit();
  }
  setSelection(id: Id | null): void {
    if (id !== this.tool.selection) this.nodeTool.setSelection(null);
    this.tool.setSelection(id);
    this.emit();
  }

  // ---- Pen tool ----------------------------------------------------------

  /** What the pen is drawing: a new shape layer, or a mask on a layer. Null when the pen is off. */
  get penTarget(): PenTarget | null {
    return this.penTargetState;
  }
  get penPoints(): number {
    return this.pen.count;
  }
  startPen(target: PenTarget): void {
    this.pen.clear();
    this.penTargetState = target;
    this.setPointEdit(false);
  }
  cancelPen(): void {
    this.pen.clear();
    this.penTargetState = null;
    this.emit();
  }
  undoPenPoint(): void {
    this.pen.popPoint();
    this.emit();
  }

  /** Matrix from the space the pen's points live in to the composition (identity for new shapes). */
  private penSpace(): Affine | null {
    const t = this.penTargetState;
    if (!t) return null;
    if (t.kind === "shape") return [1, 0, 0, 1, 0, 0];
    return evaluateScene(this.document, this.time).find((i) => i.id === t.layerId)?.matrix ?? null;
  }

  /** Turn what has been drawn into a layer or mask. Masks are always closed. */
  finishPen(closed: boolean): void {
    const t = this.penTargetState;
    const nodes = this.pen.path.nodes;
    if (!t || nodes.length < (closed || t.kind === "mask" ? 3 : 2)) {
      this.cancelPen();
      return;
    }
    this.pen.clear();
    this.penTargetState = null;
    if (t.kind === "shape") {
      const layer = newPathLayer(nextLayerNumber(this.document.layers), { nodes, closed });
      if (layer) {
        this.execute(addLayer(layer));
        this.setSelection(layer.id);
        return;
      }
    } else {
      const id = `mask${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
      this.execute(addMask(t.layerId, newMask(id, nodesToPath([{ nodes, closed: true }]))));
      return;
    }
    this.emit();
  }

  /** The path being drawn in canvas pixels, for the overlay. */
  penOverlay(): { d: string; nodes: { x: number; y: number; first: boolean }[]; handles: { x: number; y: number; fromX: number; fromY: number }[] } | null {
    const m = this.penSpace();
    if (!m || this.pen.count === 0) return null;
    const screen = transformPath(this.pen.path, multiply(this.view, m));
    const nodes = screen.nodes.map((n, i) => ({ x: n.x, y: n.y, first: i === 0 }));
    const last = screen.nodes[screen.nodes.length - 1]!;
    const handles: { x: number; y: number; fromX: number; fromY: number }[] = [];
    if (last.ox || last.oy) handles.push({ fromX: last.x, fromY: last.y, x: last.x + last.ox, y: last.y + last.oy });
    if (last.ix || last.iy) handles.push({ fromX: last.x, fromY: last.y, x: last.x + last.ix, y: last.y + last.iy });
    return { d: nodesToPath([screen]), nodes, handles };
  }

  private penEvent(kind: "down" | "move" | "up", p: PointerInput): void {
    const m = this.penSpace();
    const inv = m ? invert(m) : null;
    if (!m || !inv) return;
    const [cx, cy] = this.screenToComp(p.x, p.y);
    const [x, y] = apply(inv, cx, cy);
    const k = Math.hypot(this.view[0], this.view[1]);
    const unitsPerPx = (k > 0 ? 1 / k : 1) / Math.max(maxScale(m), 1e-9);
    if (kind === "down") {
      if (this.pen.down(p.id, x, y, unitsPerPx).closed) return this.finishPen(true);
    } else if (kind === "move") this.pen.move(p.id, x, y, unitsPerPx);
    else this.pen.up(p.id);
    this.emit();
  }

  // ---- Point editing -------------------------------------------------------

  /** True while the pen edits the selected shape's points instead of moving the layer. */
  get pointEdit(): boolean {
    return this.pointEditOn;
  }
  /** Which mask's path is being edited, or null for the shape's own path. */
  get pointMask(): string | null {
    return this.pointMaskId;
  }
  setPointEdit(on: boolean, maskId: string | null = null): void {
    this.pointEditOn = on;
    this.pointMaskId = on ? maskId : null;
    this.nodeTool.cancel();
    this.nodeTool.setSelection(null);
    this.dropPreview();
    this.emit();
  }
  get nodeSelection(): NodeSel | null {
    return this.nodeTool.selection;
  }

  private pathsOf(doc: Composition, id: Id): NodePath[] | undefined {
    const layer = doc.layers.find((l) => l.id === id);
    const d = this.pointMaskId ? layer?.masks?.find((m) => m.id === this.pointMaskId)?.path : layer?.shape?.path;
    if (d === undefined) return undefined;
    if (this.parsed?.d !== d) {
      try {
        this.parsed = { d, paths: parseNodes(d) };
      } catch {
        return undefined;
      }
    }
    return this.parsed.paths;
  }

  /** The shape being point-edited, if point editing is on and the selection is an editable shape. */
  private pointLayer(): Id | null {
    const id = this.tool.selection;
    return this.pointEditOn && id !== null && this.pathsOf(this.document, id) ? id : null;
  }

  private nodeContext(id: Id): NodeContext | null {
    const item = evaluateScene(this.document, this.time).find((i) => i.id === id);
    const paths = this.pathsOf(this.document, id);
    if (!item || !paths) return null;
    const k = Math.hypot(this.view[0], this.view[1]);
    return { paths, matrix: item.matrix, unitsPerPx: k > 0 ? 1 / k : 1 };
  }

  private editPoints(id: Id, paths: readonly NodePath[]) {
    if (this.pointMaskId) return patchMask(id, this.pointMaskId, "Edit mask points", (m) => ({ ...m, path: nodesToPath(paths) }));
    return editShape(id, "Edit points", (s) => ({ ...s, path: nodesToPath(paths) }));
  }

  private routeNode(id: Id, out: NodeOutput): void {
    if (out.edit) {
      const cmd = this.editPoints(id, out.edit.paths);
      if (out.edit.final) {
        this.preview = null;
        this.execute(cmd);
        return;
      }
      this.preview = cmd.apply(this.document);
    }
    if (out.edit || out.select !== undefined) this.emit();
  }

  /** Smooth / corner / delete for the selected point. */
  nodeAction(kind: "smooth" | "corner" | "delete"): void {
    const id = this.tool.selection;
    const sel = this.nodeTool.selection;
    const paths = id ? this.pathsOf(this.document, id) : undefined;
    if (!id || !sel || !paths || !paths[sel.pi]?.nodes[sel.ni]) return;
    const next = kind === "smooth" ? setSmooth(paths, sel.pi, sel.ni) : kind === "corner" ? setCorner(paths, sel.pi, sel.ni) : deleteNode(paths, sel.pi, sel.ni);
    if (kind === "delete") this.nodeTool.setSelection(null);
    this.execute(this.editPoints(id, next));
  }

  /** Whether the selected point is smooth (for the UI's Smooth/Corner state), or null when nothing is selected. */
  selectedNodeSmooth(): boolean | null {
    const id = this.tool.selection;
    const sel = this.nodeTool.selection;
    const n = id && sel ? this.pathsOf(this.document, id)?.[sel.pi]?.nodes[sel.ni] : undefined;
    return n ? isSmooth(n) : null;
  }

  /** Points and the selected point's handles in canvas CSS pixels, for drawing. Null when not point editing. */
  nodeOverlay(): { nodes: { x: number; y: number; selected: boolean }[]; handles: { x: number; y: number; fromX: number; fromY: number }[] } | null {
    const id = this.pointLayer();
    if (!id) return null;
    const item = evaluateScene(this.displayed, this.time).find((i) => i.id === id);
    const paths = this.pathsOf(this.displayed, id);
    if (!item || !paths) return null;
    const m = multiply(this.view, item.matrix);
    const sel = this.nodeTool.selection;
    const nodes: { x: number; y: number; selected: boolean }[] = [];
    const handles: { x: number; y: number; fromX: number; fromY: number }[] = [];
    paths.forEach((p, pi) =>
      p.nodes.forEach((n, ni) => {
        const [x, y] = apply(m, n.x, n.y);
        const selected = !!sel && sel.pi === pi && sel.ni === ni;
        nodes.push({ x, y, selected });
        if (selected) {
          if (n.ix || n.iy) handles.push({ fromX: x, fromY: y, ...pt(apply(m, n.x + n.ix, n.y + n.iy)) });
          if (n.ox || n.oy) handles.push({ fromX: x, fromY: y, ...pt(apply(m, n.x + n.ox, n.y + n.oy)) });
        }
      }),
    );
    return { nodes, handles };
  }

  /** Scene to draw (with any in-progress drag applied). */
  scene(): SceneItem[] {
    return evaluateScene(this.displayed, this.time);
  }

  /** Resolves a loaded picture by asset id. The app sets this; until a picture loads it returns undefined. */
  bitmapOf: (asset: string) => ImageBitmap | undefined = () => undefined;

  /** Local-space geometry for a layer. Shapes are built once per shape object; image layers are a cheap shared rectangle. */
  geometryOf(id: Id): ShapeGeometry | undefined {
    const layer = this.displayed.layers.find((l) => l.id === id);
    if (!layer) return undefined;
    if (layer.image) return buildImageGeometry(layer.image, this.bitmapOf(layer.image.asset));
    if (layer.video) return buildVideoGeometry(layer.video);
    const shape = layer.shape;
    if (!shape) return undefined;
    let g = this.geometry.get(shape);
    if (!g) {
      g = buildLayerGeometry(layer, () => undefined);
      if (g) this.geometry.set(shape, g);
    }
    return g;
  }

  /** Triangles for a mask path, built once per mask object. */
  maskMesh(mask: Mask): Mesh | undefined {
    let m = this.masks.get(mask);
    if (!m) {
      try {
        m = tessellateFill(flatten(parseSvgPath(mask.path), 0.1));
      } catch {
        return undefined;
      }
      this.masks.set(mask, m);
    }
    return m;
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
      this.nodeTool.cancel();
      this.dropPreview();
      this.gesture.down(p.id, p.x, p.y);
      return;
    }
    if (this.penTargetState) return this.penEvent("down", p);
    const pl = this.pointLayer();
    const nc = pl ? this.nodeContext(pl) : null;
    if (pl && nc) {
      const [x, y] = this.screenToComp(p.x, p.y);
      this.routeNode(pl, this.nodeTool.down(p.id, x, y, nc));
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
    if (this.penTargetState) return this.penEvent("move", p);
    if (this.nodeTool.dragging) return this.nodeEvent("move", p);
    this.route(this.tool.move(p.id, this.toolEvent(p), this.toolContext()));
  }

  pointerUp(p: PointerInput): void {
    if (p.type === "touch") {
      this.gesture.up(p.id);
      return;
    }
    if (this.penTargetState) return this.penEvent("up", p);
    if (this.nodeTool.dragging) return this.nodeEvent("up", p);
    this.route(this.tool.up(p.id, this.toolEvent(p), this.toolContext()));
  }

  pointerCancel(p: PointerInput): void {
    if (p.type === "touch") this.gesture.up(p.id);
    else {
      this.tool.cancel();
      this.nodeTool.cancel();
      this.dropPreview();
      this.emit();
    }
  }

  private nodeEvent(kind: "move" | "up", p: PointerInput): void {
    const id = this.tool.selection;
    const nc = id ? this.nodeContext(id) : null;
    if (!id || !nc) {
      this.nodeTool.cancel();
      return;
    }
    const [x, y] = this.screenToComp(p.x, p.y);
    this.routeNode(id, kind === "move" ? this.nodeTool.move(p.id, x, y, nc) : this.nodeTool.up(p.id, x, y, nc));
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

  /**
   * Show the result of `cmd` without committing it (a number field being scrubbed).
   * Pass null to drop it. Commit with `execute`, which records one undo step.
   */
  setPreview(cmd: Command | null): void {
    this.preview = cmd ? cmd.apply(this.history.current) : null;
    this.emit();
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

const pt = ([x, y]: [number, number]) => ({ x, y });
