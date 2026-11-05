import { IDENTITY, multiply, rotate, scale, translate, type Affine } from "../core/affine";
import type { Rgba } from "../core/types";
import { nodesToPath, parseNodes, transformPath } from "./nodes";

/** One drawable element from an SVG file, in the SVG's own user units. */
export interface SvgShape {
  readonly name: string;
  /** Plain M/L/C/Z path data with all transforms baked in. */
  readonly path: string;
  readonly fill?: Rgba;
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

interface Style {
  fill: Rgba | "none" | null; // null = unspecified-so-far -> black default applied at the end
  stroke: Rgba | "none";
  strokeWidth: number;
  join: "miter" | "round" | "bevel";
  cap: "butt" | "round" | "square";
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
}

const BASE: Style = { fill: [0, 0, 0, 1], stroke: "none", strokeWidth: 1, join: "miter", cap: "butt", opacity: 1, fillOpacity: 1, strokeOpacity: 1 };

/** Parse SVG text into shapes. Pure: no DOM (works under Node). Throws when there is no <svg>. */
export function importSvg(src: string): SvgImport {
  const { els, css } = tokenize(src);
  const rules = parseCss(css);
  const root = els.find((e) => e.tag === "svg" && e.open);
  if (!root) throw new Error("Not an SVG file");

  const skipped = new Set<string>();
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
      if (e.tag !== "defs") skipped.add(e.tag);
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
      if (v.startsWith("url(")) { skipped.add("gradient/pattern fill"); return cur === "none" ? "none" : [0.5, 0.5, 0.5, 1]; }
      if (v === "currentColor") return cur;
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
    const path = nodesToPath(nodes.map((p) => transformPath(p, m)));
    const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    const fill = s.fill && s.fill !== "none" && e.tag !== "line" ? ([s.fill[0], s.fill[1], s.fill[2], s.fill[3] * s.fillOpacity * s.opacity] as Rgba) : undefined;
    const st = s.stroke !== "none" && s.strokeWidth > 0 ? ([s.stroke[0], s.stroke[1], s.stroke[2], s.stroke[3] * s.strokeOpacity * s.opacity] as Rgba) : undefined;
    if (!fill && !st) continue;
    count++;
    shapes.push({
      name: merged["id"] ?? `${e.tag[0]!.toUpperCase()}${e.tag.slice(1)} ${count}`,
      path,
      ...(fill ? { fill } : {}),
      ...(st ? { stroke: { color: st, width: s.strokeWidth * Math.sqrt(det), join: s.join, cap: s.cap } } : {}),
    });
  }
  return { width, height, shapes, skipped: [...skipped] };
}
