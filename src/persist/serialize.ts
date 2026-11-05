import { BLEND_MODES, MAX_GRADIENT_STOPS, type BlendMode, type Effect, type EffectType, type Gradient, type Mask, type Matte } from "../core/types";
import { EFFECT_BY_TYPE } from "../core/effects";
import type { Bezier, Composition, ImageContent, Keyframe, Layer, Rgba, ShapeContent, TextContent, Track, Transform, VideoContent } from "../core/types";

/** Bump when the stored shape changes, and add a step to `migrate`. */
export const FORMAT_VERSION = 1;

interface Envelope {
  readonly app: "rippleflow";
  readonly version: number;
  readonly composition: Composition;
}

export function serialize(comp: Composition): string {
  const env: Envelope = { app: "rippleflow", version: FORMAT_VERSION, composition: comp };
  return JSON.stringify(env);
}

export class FormatError extends Error {}

const fail = (what: string): never => {
  throw new FormatError(`Invalid project file: ${what}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, what: string): number => (typeof v === "number" && Number.isFinite(v) ? v : fail(`${what} must be a finite number`));
const str = (v: unknown, what: string): string => (typeof v === "string" ? v : fail(`${what} must be a string`));
const pos = (v: unknown, what: string): number => {
  const n = num(v, what);
  return n > 0 ? n : fail(`${what} must be positive`);
};

function bezier(v: unknown, what: string): Bezier {
  if (!Array.isArray(v) || v.length !== 4) return fail(`${what} must have 4 numbers`);
  const [a, b, c, d] = v.map((x, i) => num(x, `${what}[${i}]`)) as [number, number, number, number];
  if (a < 0 || a > 1 || c < 0 || c > 1) fail(`${what} x handles must be within 0..1`);
  return [a, b, c, d];
}

function rgba(v: unknown, what: string): Rgba {
  if (!Array.isArray(v) || v.length !== 4) return fail(`${what} must have 4 numbers`);
  const c = v.map((x, i) => Math.min(1, Math.max(0, num(x, `${what}[${i}]`))));
  return [c[0]!, c[1]!, c[2]!, c[3]!];
}

function track(v: unknown, what: string): Track {
  if (!isObj(v) || !Array.isArray(v.keys)) return fail(`${what} must have a keys array`);
  const seen = new Set<string>();
  const keys: Keyframe[] = v.keys.map((k, i) => {
    if (!isObj(k)) return fail(`${what}.keys[${i}] must be an object`);
    const id = str(k.id, `${what}.keys[${i}].id`);
    if (seen.has(id)) fail(`${what} has a duplicate key id ${id}`);
    seen.add(id);
    const t = num(k.t, `${what}.keys[${i}].t`);
    if (t < 0) fail(`${what}.keys[${i}].t must not be negative`);
    const value = num(k.value, `${what}.keys[${i}].value`);
    return k.ease === undefined ? { id, t, value } : { id, t, value, ease: bezier(k.ease, `${what}.keys[${i}].ease`) };
  });
  keys.sort((a, b) => a.t - b.t);
  return { keys };
}

const TRACKS: (keyof Transform)[] = ["anchorX", "anchorY", "x", "y", "scaleX", "scaleY", "rotation", "opacity"];

function effects(v: unknown, what: string): Effect[] {
  if (!Array.isArray(v)) return fail(`${what} must be an array`);
  const seen = new Set<string>();
  return v.map((raw, i) => {
    const w = `${what}[${i}]`;
    if (!isObj(raw)) return fail(`${w} must be an object`);
    const id = str(raw.id, `${w}.id`);
    if (seen.has(id)) fail(`${w} duplicates effect id ${id}`);
    seen.add(id);
    const type = str(raw.type, `${w}.type`);
    const spec = EFFECT_BY_TYPE[type as EffectType];
    if (!spec) return fail(`${w}.type ${type} is not a known effect`);
    if (!isObj(raw.values)) return fail(`${w}.values must be an object`);
    const values: Record<string, Track> = {};
    for (const p of spec.params) values[p.key] = track(raw.values[p.key] ?? { keys: [] }, `${w}.values.${p.key}`);
    const out: { -readonly [K in keyof Effect]: Effect[K] } = { id, type: type as EffectType, values };
    if (raw.enabled !== undefined) {
      if (typeof raw.enabled !== "boolean") fail(`${w}.enabled must be true or false`);
      out.enabled = raw.enabled as boolean;
    }
    if (raw.color !== undefined) out.color = rgba(raw.color, `${w}.color`);
    return out;
  });
}

function masks(v: unknown, what: string): Mask[] {
  if (!Array.isArray(v)) return fail(`${what} must be an array`);
  const seen = new Set<string>();
  return v.map((raw, i) => {
    const w = `${what}[${i}]`;
    if (!isObj(raw)) return fail(`${w} must be an object`);
    const id = str(raw.id, `${w}.id`);
    if (seen.has(id)) fail(`${w} duplicates mask id ${id}`);
    seen.add(id);
    const mode = (["add", "subtract", "intersect"] as const).find((m) => m === raw.mode) ?? fail(`${w}.mode must be add, subtract or intersect`);
    const feather = num(raw.feather, `${w}.feather`);
    const opacity = num(raw.opacity, `${w}.opacity`);
    if (feather < 0) fail(`${w}.feather must not be negative`);
    if (opacity < 0 || opacity > 1) fail(`${w}.opacity must be within 0..1`);
    return { id, path: str(raw.path, `${w}.path`), mode, feather, opacity, ...(raw.inverted === true ? { inverted: true } : {}) };
  });
}

function gradient(v: unknown, what: string): Gradient {
  if (!isObj(v)) return fail(`${what} must be an object`);
  const kind = (["linear", "radial"] as const).find((k) => k === v.kind) ?? fail(`${what}.kind must be linear or radial`);
  if (!Array.isArray(v.stops) || v.stops.length < 2 || v.stops.length > MAX_GRADIENT_STOPS) return fail(`${what}.stops needs 2 to ${MAX_GRADIENT_STOPS} stops`);
  let prev = -Infinity;
  const stops = v.stops.map((st, i) => {
    if (!isObj(st)) return fail(`${what}.stops[${i}] must be an object`);
    const offset = num(st.offset, `${what}.stops[${i}].offset`);
    if (offset < 0 || offset > 1 || offset < prev) fail(`${what}.stops must ascend within 0..1`);
    prev = offset;
    return { offset, color: rgba(st.color, `${what}.stops[${i}].color`) };
  });
  return { kind, angle: v.angle === undefined ? 0 : num(v.angle, `${what}.angle`), stops };
}

function text(v: unknown, what: string): TextContent {
  if (!isObj(v)) return fail(`${what} must be an object`);
  const size = num(v.size, `${what}.size`);
  if (size <= 0) fail(`${what}.size must be positive`);
  const align = (["left", "center", "right"] as const).find((a) => a === v.align) ?? fail(`${what}.align`);
  const out: { -readonly [K in keyof TextContent]: TextContent[K] } = { text: str(v.text, `${what}.text`), size, tracking: num(v.tracking, `${what}.tracking`), align };
  if (v.animator !== undefined) {
    const a = v.animator;
    if (!isObj(a) || !isObj(a.from)) return fail(`${what}.animator must be an object with from`);
    const unit = (["char", "word", "line"] as const).find((u) => u === a.unit) ?? fail(`${what}.animator.unit`);
    const duration = num(a.duration, `${what}.animator.duration`);
    if (duration < 0) fail(`${what}.animator.duration must not be negative`);
    out.animator = {
      unit,
      start: num(a.start, `${what}.animator.start`),
      stagger: num(a.stagger, `${what}.animator.stagger`),
      duration,
      ease: bezier(a.ease, `${what}.animator.ease`),
      from: {
        opacity: num(a.from.opacity, `${what}.animator.from.opacity`),
        dx: num(a.from.dx, `${what}.animator.from.dx`),
        dy: num(a.from.dy, `${what}.animator.from.dy`),
        scale: num(a.from.scale, `${what}.animator.from.scale`),
        rotation: num(a.from.rotation, `${what}.animator.from.rotation`),
      },
    };
  }
  return out;
}

function shape(v: unknown, what: string): ShapeContent {
  if (!isObj(v)) return fail(`${what} must be an object`);
  const out: { path: string; fill?: Rgba; gradient?: Gradient; stroke?: ShapeContent["stroke"]; trim?: ShapeContent["trim"] } = { path: str(v.path, `${what}.path`) };
  if (v.trim !== undefined) {
    if (!isObj(v.trim)) return fail(`${what}.trim must be an object`);
    out.trim = { start: track(v.trim.start ?? { keys: [] }, `${what}.trim.start`), end: track(v.trim.end ?? { keys: [] }, `${what}.trim.end`) };
  }
  if (v.fill !== undefined) out.fill = rgba(v.fill, `${what}.fill`);
  if (v.gradient !== undefined) out.gradient = gradient(v.gradient, `${what}.gradient`);
  if (v.stroke !== undefined) {
    const s = v.stroke;
    if (!isObj(s)) return fail(`${what}.stroke must be an object`);
    const join = s.join === undefined ? undefined : (["miter", "round", "bevel"] as const).find((j) => j === s.join) ?? fail(`${what}.stroke.join`);
    const cap = s.cap === undefined ? undefined : (["butt", "round", "square"] as const).find((c) => c === s.cap) ?? fail(`${what}.stroke.cap`);
    out.stroke = { color: rgba(s.color, `${what}.stroke.color`), width: pos(s.width, `${what}.stroke.width`), ...(join ? { join } : {}), ...(cap ? { cap } : {}) };
  }
  return out;
}

function image(v: unknown, what: string): ImageContent {
  if (!isObj(v)) return fail(`${what} must be an object`);
  const asset = str(v.asset, `${what}.asset`);
  if (!/^[0-9a-f]{16,64}$/.test(asset)) fail(`${what}.asset must be a lowercase hex content hash`);
  const out: { -readonly [K in keyof ImageContent]: ImageContent[K] } = { asset, width: pos(v.width, `${what}.width`), height: pos(v.height, `${what}.height`) };
  if (v.pins !== undefined) {
    if (!Array.isArray(v.pins) || v.pins.length > 64) return fail(`${what}.pins must be an array of at most 64 pins`);
    out.pins = v.pins.map((p, i) => {
      if (!isObj(p)) return fail(`${what}.pins[${i}] must be an object`);
      return { id: str(p.id, `${what}.pins[${i}].id`), x: num(p.x, `${what}.pins[${i}].x`), y: num(p.y, `${what}.pins[${i}].y`), dx: track(p.dx ?? { keys: [] }, `${what}.pins[${i}].dx`), dy: track(p.dy ?? { keys: [] }, `${what}.pins[${i}].dy`) };
    });
  }
  return out;
}

function video(v: unknown, what: string): VideoContent {
  if (!isObj(v)) return fail(`${what} must be an object`);
  const asset = str(v.asset, `${what}.asset`);
  if (!/^[0-9a-f]{16,64}$/.test(asset)) fail(`${what}.asset must be a lowercase hex content hash`);
  const rotation = ([0, 90, 180, 270] as const).find((r) => r === v.rotation) ?? fail(`${what}.rotation must be 0, 90, 180 or 270`);
  return {
    asset,
    codedWidth: pos(v.codedWidth, `${what}.codedWidth`),
    codedHeight: pos(v.codedHeight, `${what}.codedHeight`),
    rotation,
    duration: pos(v.duration, `${what}.duration`),
    start: num(v.start, `${what}.start`),
  };
}

function layer(v: unknown, i: number): Layer {
  const what = `layers[${i}]`;
  if (!isObj(v)) return fail(`${what} must be an object`);
  const kind = (["shape", "image", "video"] as const).find((k) => k === v.kind) ?? fail(`${what}.kind`);
  if (!isObj(v.transform)) return fail(`${what}.transform must be an object`);
  const tr = v.transform;
  const transform = Object.fromEntries(TRACKS.map((p) => [p, track(tr[p] ?? { keys: [] }, `${what}.transform.${p}`)])) as unknown as Transform;
  const out: { -readonly [K in keyof Layer]: Layer[K] } = { id: str(v.id, `${what}.id`), name: str(v.name, `${what}.name`), kind, transform };
  if (v.blend !== undefined) out.blend = (BLEND_MODES as readonly unknown[]).includes(v.blend) ? (v.blend as BlendMode) : fail(`${what}.blend must be one of ${BLEND_MODES.join(", ")}`);
  if (v.hidden === true) out.hidden = true;
  if (v.masks !== undefined) out.masks = masks(v.masks, `${what}.masks`);
  if (v.matte !== undefined) {
    const m = v.matte;
    if (!isObj(m)) return fail(`${what}.matte must be an object`);
    const mode = (["alpha", "alphaInverted", "luma", "lumaInverted"] as const).find((x) => x === m.mode) ?? fail(`${what}.matte.mode`);
    out.matte = { source: str(m.source, `${what}.matte.source`), mode } as Matte;
  }
  if (v.effects !== undefined) out.effects = effects(v.effects, `${what}.effects`);
  if (v.parent !== undefined) out.parent = str(v.parent, `${what}.parent`);
  if (v.shape !== undefined) out.shape = shape(v.shape, `${what}.shape`);
  if (v.text !== undefined) out.text = text(v.text, `${what}.text`);
  if (v.image !== undefined) out.image = image(v.image, `${what}.image`);
  if (v.video !== undefined) out.video = video(v.video, `${what}.video`);
  if (kind === "video" && !out.video) fail(`${what} is a video layer without video content`);
  if (kind === "image" && !out.image) fail(`${what} is an image layer without image content`);
  if (v.inPoint !== undefined) out.inPoint = num(v.inPoint, `${what}.inPoint`);
  if (v.outPoint !== undefined) out.outPoint = num(v.outPoint, `${what}.outPoint`);
  return out;
}

/** Upgrade older stored shapes to the current one. Add a case per version bump. */
function migrate(version: number, composition: unknown): unknown {
  if (version === FORMAT_VERSION) return composition;
  return fail(`version ${version} is not supported (this app reads version ${FORMAT_VERSION})`);
}

/**
 * Parse and validate stored text. Never trusts the input: wrong types, missing
 * fields, duplicate ids, dangling or cyclic parents and bad easing all throw a
 * FormatError instead of producing a document that breaks the editor later.
 */
export function deserialize(text: string): Composition {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("not valid JSON");
  }
  if (!isObj(raw) || raw.app !== "rippleflow") return fail("not a RippleFlow project");
  const c = migrate(num(raw.version, "version"), raw.composition);
  if (!isObj(c)) return fail("composition must be an object");
  if (!Array.isArray(c.layers)) return fail("layers must be an array");
  const layers = c.layers.map(layer);

  const ids = new Set<string>();
  for (const l of layers) {
    if (ids.has(l.id)) fail(`duplicate layer id ${l.id}`);
    ids.add(l.id);
  }
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const l of layers) {
    if (l.matte && (!byId.has(l.matte.source) || l.matte.source === l.id)) fail(`layer ${l.id} has an invalid matte source ${l.matte.source}`);
  }
  for (const l of layers) {
    const walk = new Set<string>([l.id]);
    for (let p = l.parent; p !== undefined; p = byId.get(p)!.parent) {
      if (!byId.has(p)) fail(`layer ${l.id} has missing parent ${p}`);
      if (walk.has(p)) fail(`parent cycle through layer ${p}`);
      walk.add(p);
    }
  }
  const out: Composition = { width: pos(c.width, "width"), height: pos(c.height, "height"), fps: pos(c.fps, "fps"), duration: pos(c.duration, "duration"), layers };
  const named = c.name === undefined ? out : { ...out, name: str(c.name, "name").slice(0, 80) };
  return c.background === undefined ? named : { ...named, background: rgba(c.background, "background") };
}
