import { IDENTITY, multiply, rotate, scale, translate, type Affine } from "../core/affine";
import type { Gradient, GradientStop, Rgba } from "../core/types";
import { nodesToPath, parseNodes, pathBounds, transformPath } from "./nodes";

/** One drawable element from an SVG file, in the SVG's own user units. */
export interface SvgShape {
  readonly name: string;
  /** Plain M/L/C/Z path data with all transforms baked in. */
  readonly path: string;
  readonly fill?: Rgba;
  /** Approximated from the SVG gradient (mapped onto the shape box). */
  readonly gradient?: Gradient;
  readonly stroke?: { color: Rgba; width: number; join: "miter" | "round" | "bevel"; cap: "butt" | "round" | "square" };
}

export interface SvgImport {
  readonly width: number;
  readonly height: number;
  readonly shapes: SvgShape[];
  /** Things the importer does not support and ignored (gradients, clips, text, images...). */
  readonly skipped: string[];
}

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500",
  purple: "#800080", pink: "#ffc0cb", gray: "#808080", grey: "#808080", cyan: "#00ffff", magenta: "#ff00ff", lime: "#00ff00",
  navy: "#000080", teal: "#008080", maroon: "#800000", silver: "#c0c0c0", brown: "#a52a2a", gold: "#ffd700",
};

/** Parse a CSS colour. `null` = unsupported/invalid, `"none"` = explicitly nothing. */
export function parseColor(s: string): Rgba | "none" | null {
  const v = s.trim().toLowerCase();
  if (v === "none" || v === "transparent") return "none";
  const hex = NAMED[v] ?? v;
  let m = /^#([0-9a-f]{3})$/.exec(hex);
  if (m) return [...m[1]!].map((c) => parseInt(c + c, 16) / 255).concat(1) as unknown as Rgba;
  m = /^#([0-9a-f]{6})$/.exec(hex);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16) / 255).concat(1) as unknown as Rgba;
  m = /^#([0-9a-f]{8})$/.exec(hex);
  if (m) return [0, 2, 4, 6].map((i) => parseInt(m![1]!.slice(i, i + 2), 16) / 255) as unknown as Rgba;
  const f = /^rgba?\(([^)]+)\)$/.exec(v);
  if (f) {
    const p = f[1]!.split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith("%") ? (parseFloat(x) / 100) : parseFloat(x)));
    if (p.length >= 3 && p.every((x) => !Number.isNaN(x))) {
      const pct = f[1]!.includes("%");
      const ch = (x: number) => Math.min(1, Math.max(0, pct ? x : x / 255));
      return [ch(p[0]!), ch(p[1]!), ch(p[2]!), p[3] === undefined ? 1 : Math.min(1, Math.max(0, p[3]))];
    }
  }
  return null;
}

/** Parse an SVG `transform` attribute into one matrix. Unknown functions are ignored. */
export function parseTransform(s: string | undefined): Affine {
  let m: Affine = IDENTITY;
  if (!s) return m;
  for (const t of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (t[2] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    let n: Affine | null = null;
    switch (t[1]) {
      case "matrix": if (a.length === 6) n = a as unknown as Affine; break;
      case "translate": n = translate(a[0] ?? 0, a[1] ?? 0); break;
      case "scale": n = scale(a[0] ?? 1, a[1] ?? a[0] ?? 1); break;
      case "rotate": {
        const r = rotate(((a[0] ?? 0) * Math.PI) / 180);
        n = a.length >= 3 ? multiply(translate(a[1]!, a[2]!), multiply(r, translate(-a[1]!, -a[2]!))) : r;
        break;
      }
      case "skewX": n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case "skewY": n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    if (n && n.every(Number.isFinite)) m = multiply(m, n);
  }
  return m;
}

interface El {
  tag: string;
  attrs: Record<string, string>;
  /** false for a closing tag */
  open: boolean;
  selfClose: boolean;
}

function tokenize(src: string): { els: El[]; css: string } {
  const els: El[] = [];
  let css = "";
  const clean = src.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (const m of clean.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += m[1];
  const body = clean.replace(/<style[\s\S]*?<\/style>/gi, "");
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[a[1]!] = a[2] ?? a[3] ?? a[4] ?? "";
    els.push({ tag: m[2]!.toLowerCase().replace(/^svg:/, ""), attrs, open: m[1] === "", selfClose: m[4] === "/" });
  }
  return { els, css };
}

function parseCss(css: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decl = declarations(m[2]!);
    for (const sel of m[1]!.split(",")) {
      const key = sel.trim();
      if (/^[.#]?[\w-]+$/.test(key) || /^[a-z]+\.[\w-]+$/i.test(key)) rules.set(key, { ...(rules.get(key) ?? {}), ...decl });
    }
  }
  return rules;
}

function declarations(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const d of s.split(";")) {
    const i = d.indexOf(":");
    if (i > 0) o[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
  }
  return o;
}

const num = (s: string | undefined, d = 0): number => {
  const v = s === undefined ? NaN : parseFloat(s);
  return Number.isFinite(v) ? v : d;
};

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (rx <= 0 || ry <= 0) return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
  return `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
}

interface GradDef {
  kind: "linear" | "radial";
  attrs: Record<string, string>;
  stops: GradientStop[];
}

/** Collect <linearGradient>/<radialGradient> definitions (with href inheritance of stops/attrs). */
function collectGradients(els: El[], rules: Map<string, Record<string, string>>): Map<string, GradDef> {
  const defs = new Map<string, GradDef>();
  let cur: GradDef | null = null;
  for (const e of els) {
    if (e.tag === "lineargradient" || e.tag === "radialgradient") {
      if (!e.open) { cur = null; continue; }
      cur = { kind: e.tag === "lineargradient" ? "linear" : "radial", attrs: e.attrs, stops: [] };
      if (e.attrs["id"]) defs.set(e.attrs["id"], cur);
      if (e.selfClose) cur = null;
    } else if (e.tag === "stop" && e.open && cur) {
      const cls = (e.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
      const props: Record<string, string> = { ...e.attrs };
      for (const c of cls) Object.assign(props, rules.get(`.${c}`));
      Object.assign(props, declarations(e.attrs["style"] ?? ""));
      const c = parseColor(props["stop-color"] ?? "#000");
      const col: Rgba = c && c !== "none" ? c : [0, 0, 0, 1];
      const off = props["offset"] ?? "0";
      const o = off.endsWith("%") ? parseFloat(off) / 100 : parseFloat(off);
      const op = num(props["stop-opacity"], 1);
      cur.stops.push({ offset: Math.min(1, Math.max(0, Number.isFinite(o) ? o : 0)), color: [col[0], col[1], col[2], col[3] * Math.min(1, Math.max(0, op))] });
    }
  }
  // href inheritance: take stops / missing attributes from the referenced gradient.
  for (const g of defs.values()) {
    const ref = (g.attrs["href"] ?? g.attrs["xlink:href"] ?? "").replace(/^#/, "");
    let base = ref ? defs.get(ref) : undefined;
    for (let depth = 0; base && depth < 8; depth++, base = defs.get((base.attrs["href"] ?? base.attrs["xlink:href"] ?? "").replace(/^#/, ""))) {
      if (g.stops.length === 0) g.stops = base.stops;
      g.attrs = { ...base.attrs, ...g.attrs };
    }
  }
  return defs;
}

const frac = (v: string | undefined, d: number): number => {
  if (v === undefined) return d;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return d;
  return v.trim().endsWith("%") ? n / 100 : n;
};

/**
 * Convert an SVG gradient into the app's box-relative gradient. `m` maps the gradient's user space to
 * the shape's final space, `box` is the shape's box in that final space. Approximate by design: the app
 * has only a bbox-spanning linear and a centred radial gradient.
 */
function convertGradient(g: GradDef, m: Affine, box: { x: number; y: number; w: number; h: number }): Gradient | null {
  if (g.stops.length === 0) return null;
  if (g.stops.length === 1) return { kind: "linear", angle: 0, stops: [{ offset: 0, color: g.stops[0]!.color }, { offset: 1, color: g.stops[0]!.color }] };
  const units: "user" | "box" = g.attrs["gradientUnits"] === "userSpaceOnUse" ? "user" : "box";
  const gt = parseTransform(g.attrs["gradientTransform"]);
  // Gradient space -> final space. Box units map 0..1 onto the shape's box (already in final space).
  const full: Affine = units === "box" ? multiply(multiply(translate(box.x, box.y), scale(box.w, box.h)), gt) : multiply(m, gt);
  const stops = g.stops.map((x) => ({ ...x }));
  if (g.kind === "linear") {
    const x1 = frac(g.attrs["x1"], 0), y1 = frac(g.attrs["y1"], 0);
    const x2 = frac(g.attrs["x2"], 1), y2 = frac(g.attrs["y2"], 0);
    const [ax, ay] = [full[0] * x1 + full[2] * y1 + full[4], full[1] * x1 + full[3] * y1 + full[5]];
    const [bx, by] = [full[0] * x2 + full[2] * y2 + full[4], full[1] * x2 + full[3] * y2 + full[5]];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { kind: "linear", angle: 0, stops: [{ offset: 0, color: stops.at(-1)!.color }, { offset: 1, color: stops.at(-1)!.color }] };
    const ux = dx / len, uy = dy / len;
    const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]] as const;
    const proj = corners.map(([cx, cy]) => cx * ux + cy * uy);
    const pmin = Math.min(...proj), pmax = Math.max(...proj);
    const base = ax * ux + ay * uy;
    const span = Math.max(1e-9, pmax - pmin);
    const mapped = stops.map((st) => ({ offset: Math.min(1, Math.max(0, (base + st.offset * len - pmin) / span)), color: st.color }));
    return { kind: "linear", angle: (Math.atan2(uy, ux) * 180) / Math.PI, stops: mapped.slice(0, 8) };
  }
  // radial: scale offsets by radius relative to the box half-diagonal; centre assumed at the box centre.
  const r = frac(g.attrs["r"], 0.5);
  const rr = units === "box" ? r * Math.max(box.w, box.h) : r * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const half = Math.max(1e-9, Math.hypot(box.w, box.h) / 2);
  const k = rr / half;
  const mapped = stops.map((st) => ({ offset: Math.min(1, st.offset * k), color: st.color }));
  if (k < 1) mapped.push({ offset: 1, color: stops.at(-1)!.color });
  return { kind: "radial", angle: 0, stops: mapped.slice(0, 8) };
}

interface Style {
  fillRef: string | null;
  fill: Rgba | "none" | null; // null = unspecified-so-far -> black default applied at the end
  stroke: Rgba | "none";
  strokeWidth: number;
  join: "miter" | "round" | "bevel";
  cap: "butt" | "round" | "square";
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
}

const BASE: Style = { fillRef: null, fill: [0, 0, 0, 1], stroke: "none", strokeWidth: 1, join: "miter", cap: "butt", opacity: 1, fillOpacity: 1, strokeOpacity: 1 };

/** Parse SVG text into shapes. Pure: no DOM (works under Node). Throws when there is no <svg>. */
export function importSvg(src: string): SvgImport {
  const { els, css } = tokenize(src);
  const rules = parseCss(css);
  const root = els.find((e) => e.tag === "svg" && e.open);
  if (!root) throw new Error("Not an SVG file");

  const skipped = new Set<string>();
  const gradients = collectGradients(els, rules);
  const vb = (root.attrs["viewBox"] ?? "").split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0;
  const width = hasVb ? vb[2]! : num(root.attrs["width"], 100);
  const height = hasVb ? vb[3]! : num(root.attrs["height"], 100);
  const origin: Affine = hasVb ? translate(-vb[0]!, -vb[1]!) : IDENTITY;

  const shapes: SvgShape[] = [];
  const stack: { m: Affine; s: Style; hidden: boolean }[] = [{ m: origin, s: BASE, hidden: false }];
  let defsDepth = 0;
  let count = 0;

  for (const e of els) {
    if (e.tag === "svg" && e === root) continue;
    if (!e.open) {
      if (e.tag === "defs" || e.tag === "clippath" || e.tag === "mask" || e.tag === "symbol" || e.tag === "lineargradient" || e.tag === "radialgradient" || e.tag === "pattern" || e.tag === "filter") defsDepth = Math.max(0, defsDepth - 1);
      else if (e.tag === "g" || e.tag === "svg" || e.tag === "a") if (stack.length > 1) stack.pop();
      continue;
    }
    const top = stack[stack.length - 1]!;
    if (["defs", "clippath", "mask", "symbol", "lineargradient", "radialgradient", "pattern", "filter"].includes(e.tag)) {
      if (!["defs", "lineargradient", "radialgradient"].includes(e.tag)) skipped.add(e.tag);
      if (!e.selfClose) defsDepth++;
      continue;
    }
    if (defsDepth > 0) continue;

    // Resolve style: inherited -> CSS rules (tag, class, id) -> attributes -> style attribute.
    const props: Record<string, string> = {};
    const cls = (e.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
    Object.assign(props, rules.get(e.tag));
    for (const c of cls) Object.assign(props, rules.get(`.${c}`), rules.get(`${e.tag}.${c}`));
    if (e.attrs["id"]) Object.assign(props, rules.get(`#${e.attrs["id"]}`));
    const merged: Record<string, string> = { ...e.attrs, ...props, ...declarations(e.attrs["style"] ?? "") };

    const m = multiply(top.m, parseTransform(merged["transform"]));
    const s: Style = { ...top.s };
    let hidden = top.hidden;
    if (merged["display"] === "none" || merged["visibility"] === "hidden") hidden = true;
    const paint = (key: string, cur: Rgba | "none" | null): Rgba | "none" | null => {
      const v = merged[key];
      if (v === undefined || v === "inherit") return cur;
      if (v.startsWith("url(")) {
        const id = /url\(\s*['"]?#([^'")\s]+)/.exec(v)?.[1];
        if (key === "fill" && id && gradients.has(id)) { s.fillRef = id; return gradients.get(id)!.stops[0]?.color ?? [0.5, 0.5, 0.5, 1]; }
        skipped.add("pattern/gradient stroke");
        return [0.5, 0.5, 0.5, 1];
      }
      if (v === "currentColor") return cur;
      if (key === "fill") s.fillRef = null;
      return parseColor(v) ?? cur;
    };
    s.fill = paint("fill", s.fill);
    s.stroke = (paint("stroke", s.stroke) ?? "none") as Rgba | "none";
    if (merged["stroke-width"] !== undefined) s.strokeWidth = num(merged["stroke-width"], s.strokeWidth);
    const j = merged["stroke-linejoin"];
    if (j === "round" || j === "bevel" || j === "miter") s.join = j;
    const c = merged["stroke-linecap"];
    if (c === "round" || c === "square" || c === "butt") s.cap = c;
    if (merged["opacity"] !== undefined) s.opacity *= Math.min(1, Math.max(0, num(merged["opacity"], 1)));
    if (merged["fill-opacity"] !== undefined) s.fillOpacity = Math.min(1, Math.max(0, num(merged["fill-opacity"], 1)));
    if (merged["stroke-opacity"] !== undefined) s.strokeOpacity = Math.min(1, Math.max(0, num(merged["stroke-opacity"], 1)));
    if (merged["clip-path"] || merged["mask"]) skipped.add("clip-path/mask");
    if (merged["filter"]) skipped.add("filter");

    if (e.tag === "g" || e.tag === "a" || e.tag === "svg") {
      if (!e.selfClose) stack.push({ m, s, hidden });
      continue;
    }

    let d: string | null = null;
    const a = e.attrs;
    switch (e.tag) {
      case "path": d = a["d"] ?? null; break;
      case "rect": {
        const w = num(a["width"]), h = num(a["height"]);
        let rx = num(a["rx"], NaN), ry = num(a["ry"], NaN);
        if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
        if (Number.isNaN(ry)) ry = rx;
        if (w > 0 && h > 0) d = rectPath(num(a["x"]), num(a["y"]), w, h, rx, ry);
        break;
      }
      case "circle": { const r = num(a["r"]); if (r > 0) d = ellipsePath(num(a["cx"]), num(a["cy"]), r, r); break; }
      case "ellipse": { const rx = num(a["rx"]), ry = num(a["ry"]); if (rx > 0 && ry > 0) d = ellipsePath(num(a["cx"]), num(a["cy"]), rx, ry); break; }
      case "line": d = `M${num(a["x1"])} ${num(a["y1"])} L${num(a["x2"])} ${num(a["y2"])}`; break;
      case "polyline":
      case "polygon": {
        const p = (a["points"] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
        if (p.length >= 4 && p.every(Number.isFinite)) {
          d = "M" + p.slice(0, p.length - (p.length % 2)).reduce((acc, v, i) => acc + (i % 2 ? " " : i ? " L" : "") + v, "");
          if (e.tag === "polygon") d += " Z";
        }
        break;
      }
      case "text": case "tspan": skipped.add("text (convert to outlines first)"); break;
      case "image": skipped.add("embedded image"); break;
      case "use": skipped.add("use/symbol reuse"); break;
      default: break;
    }
    if (hidden || !d) continue;

    let nodes;
    try {
      nodes = parseNodes(d);
    } catch {
      skipped.add("unreadable path");
      continue;
    }
    if (nodes.length === 0) continue;
    // Open subpaths have no fill area; a fill on a line is meaningless but harmless, so keep SVG semantics.
    const baked = nodes.map((p) => transformPath(p, m));
    const path = nodesToPath(baked);
    const box = pathBounds(baked);
    const gdef = s.fillRef ? gradients.get(s.fillRef) : undefined;
    const gradient = gdef && box && box.w > 0 && box.h > 0 ? convertGradient(gdef, m, box) ?? undefined : undefined;
    const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    const fill = s.fill && s.fill !== "none" && e.tag !== "line" ? ([s.fill[0], s.fill[1], s.fill[2], s.fill[3] * s.fillOpacity * s.opacity] as Rgba) : undefined;
    const st = s.stroke !== "none" && s.strokeWidth > 0 ? ([s.stroke[0], s.stroke[1], s.stroke[2], s.stroke[3] * s.strokeOpacity * s.opacity] as Rgba) : undefined;
    if (!fill && !st) continue;
    count++;
    shapes.push({
      name: merged["id"] ?? `${e.tag[0]!.toUpperCase()}${e.tag.slice(1)} ${count}`,
      path,
      ...(fill ? { fill } : {}),
      ...(gradient && fill ? { gradient: { ...gradient, stops: gradient.stops.map((x) => ({ ...x, color: [x.color[0], x.color[1], x.color[2], x.color[3] * s.fillOpacity * s.opacity] as Rgba })) } } : {}),
      ...(st ? { stroke: { color: st, width: s.strokeWidth * Math.sqrt(det), join: s.join, cap: s.cap } } : {}),
    });
  }
  return { width, height, shapes, skipped: [...skipped] };
}
