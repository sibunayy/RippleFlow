import { parse, type Font } from "opentype.js";
import { textUnits } from "../core/text";
import type { TextContent } from "../core/types";

export interface LaidOutUnit {
  /** SVG path of this unit's outlines, in layer-local coordinates (same space as the whole text). */
  readonly path: string;
  /** Centre the unit rotates and scales about. */
  readonly pivot: readonly [number, number];
}

export interface TextLayout {
  /** Every glyph's outline, one SVG path string. */
  readonly path: string;
  /** Per animation unit, in `textUnits` order. Empty when the text has no animator. */
  readonly units: readonly LaidOutUnit[];
}

export const DEFAULT_FONT = "inter";
const loaded = new Map<string, Font>();

/** Parse and remember a font under `id` (the default font when omitted). Call at startup, when a font is picked, or in a test. */
export function setFontData(data: ArrayBuffer, id: string = DEFAULT_FONT): void {
  loaded.set(id, parse(data));
}

/** Whether the font a text layer uses (default: Inter) is ready to lay out. */
export function fontLoaded(id: string = DEFAULT_FONT): boolean {
  return loaded.has(id);
}

interface PlacedChar {
  readonly index: number;
  readonly d: string;
  readonly x: number;
  readonly adv: number;
  readonly baseline: number;
}

type Glyph = ReturnType<Font["charToGlyph"]>;

/** Lay out the text with the loaded font. Top-left of the first line's em box is (0, 0). */
const r2 = (v: number) => String(Math.round(v * 100) / 100);
/** opentype.js's own toPathData(2) emits "NaN" for some float values (its decimal rounding goes through exponent strings); this does not. */
export function pathData(cmds: readonly { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[]): string {
  const out: string[] = [];
  for (const c of cmds) {
    if (c.type === "Z") out.push("Z");
    else if (c.type === "M" || c.type === "L") out.push(`${c.type}${r2(c.x!)} ${r2(c.y!)}`);
    else if (c.type === "Q") out.push(`Q${r2(c.x1!)} ${r2(c.y1!)} ${r2(c.x!)} ${r2(c.y!)}`);
    else if (c.type === "C") out.push(`C${r2(c.x1!)} ${r2(c.y1!)} ${r2(c.x2!)} ${r2(c.y2!)} ${r2(c.x!)} ${r2(c.y!)}`);
  }
  return out.join("");
}

export function layoutText(content: TextContent, font: Font | undefined = loaded.get(content.font ?? DEFAULT_FONT)): TextLayout {
  if (!font) return { path: "", units: [] };
  const k = content.size / font.unitsPerEm;
  const lineHeight = content.size * 1.2;
  // Some fonts (Pacifico) report no usable ascender; fall back through the OS/2 and glyph-bounds metrics.
  const ascent = [font.ascender, (font.tables as any)?.os2?.sTypoAscender, (font.tables as any)?.hhea?.ascender].find((v) => Number.isFinite(v) && v > 0) ?? font.unitsPerEm * 0.8;

  // Pass 1: positions along each line.
  let offset = 0;
  const lines = content.text.split("\n").map((line) => {
    let x = 0;
    let prev: Glyph | undefined;
    const chars: { index: number; x: number; adv: number; glyph: Glyph }[] = [];
    for (let i = 0; i < line.length; i++) {
      const glyph = font.charToGlyph(line[i]!);
      if (prev) {
        const kern = font.getKerningValue(prev, glyph) * k;
        if (Number.isFinite(kern)) x += kern;
      }
      const adv = Number.isFinite(glyph.advanceWidth) ? glyph.advanceWidth! * k : 0;
      chars.push({ index: offset + i, x, adv, glyph });
      x += adv + content.tracking;
      prev = glyph;
    }
    offset += line.length + 1;
    return { chars, width: Math.max(0, x - (chars.length ? content.tracking : 0)) };
  });
  const maxW = Math.max(0, ...lines.map((l) => l.width));

  // Pass 2: alignment, then outlines.
  const placed: PlacedChar[] = [];
  lines.forEach((line, li) => {
    const shift = content.align === "center" ? (maxW - line.width) / 2 : content.align === "right" ? maxW - line.width : 0;
    const baseline = ascent * k + li * lineHeight;
    for (const c of line.chars) {
      const x = c.x + shift;
      placed.push({ index: c.index, x, adv: c.adv, baseline, d: pathData(c.glyph.getPath(x, baseline, content.size).commands) });
    }
  });
  // A glyph whose outline has non-finite numbers would make the whole path unparsable; draw nothing for it.
  placed.forEach((c, i) => {
    if (/NaN|Infinity/.test(c.d)) placed[i] = { ...c, d: "" };
  });
  const byIndex = new Map(placed.map((c) => [c.index, c]));
  const join = (cs: readonly PlacedChar[]) => cs.map((c) => c.d).filter((d) => d !== "").join(" ");
  const units: LaidOutUnit[] = content.animator
    ? textUnits(content.text, content.animator.unit).map((r) => {
        const cs: PlacedChar[] = [];
        for (let i = r.start; i < r.end; i++) {
          const c = byIndex.get(i);
          if (c) cs.push(c);
        }
        const first = cs[0];
        const last = cs[cs.length - 1];
        const pivot: [number, number] = first && last ? [(first.x + last.x + last.adv) / 2, first.baseline - content.size * 0.35] : [0, 0];
        return { path: join(cs), pivot };
      })
    : [];
  return { path: join(placed), units };
}
