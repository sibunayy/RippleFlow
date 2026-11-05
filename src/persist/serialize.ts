import type { Bezier, Composition, ImageContent, Keyframe, Layer, Rgba, ShapeContent, Track, Transform } from "../core/types";

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

function shape(v: unknown, what: string): ShapeContent {
  if (!isObj(v)) return fail(`${what} must be an object`);
  const out: { path: string; fill?: Rgba; stroke?: ShapeContent["stroke"] } = { path: str(v.path, `${what}.path`) };
  if (v.fill !== undefined) out.fill = rgba(v.fill, `${what}.fill`);
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
  return { asset, width: pos(v.width, `${what}.width`), height: pos(v.height, `${what}.height`) };
}

function layer(v: unknown, i: number): Layer {
  const what = `layers[${i}]`;
  if (!isObj(v)) return fail(`${what} must be an object`);
  const kind = (["shape", "image", "video"] as const).find((k) => k === v.kind) ?? fail(`${what}.kind`);
  if (!isObj(v.transform)) return fail(`${what}.transform must be an object`);
  const tr = v.transform;
  const transform = Object.fromEntries(TRACKS.map((p) => [p, track(tr[p] ?? { keys: [] }, `${what}.transform.${p}`)])) as unknown as Transform;
  const out: { -readonly [K in keyof Layer]: Layer[K] } = { id: str(v.id, `${what}.id`), name: str(v.name, `${what}.name`), kind, transform };
  if (v.parent !== undefined) out.parent = str(v.parent, `${what}.parent`);
  if (v.shape !== undefined) out.shape = shape(v.shape, `${what}.shape`);
  if (v.image !== undefined) out.image = image(v.image, `${what}.image`);
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
    const walk = new Set<string>([l.id]);
    for (let p = l.parent; p !== undefined; p = byId.get(p)!.parent) {
      if (!byId.has(p)) fail(`layer ${l.id} has missing parent ${p}`);
      if (walk.has(p)) fail(`parent cycle through layer ${p}`);
      walk.add(p);
    }
  }
  const out: Composition = { width: pos(c.width, "width"), height: pos(c.height, "height"), fps: pos(c.fps, "fps"), duration: pos(c.duration, "duration"), layers };
  return c.background === undefined ? out : { ...out, background: rgba(c.background, "background") };
}
