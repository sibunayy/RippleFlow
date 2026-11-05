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

let loaded: Font | undefined;

/** Parse and remember the font used for all text. Call once at startup (or in a test). */
export function setFontData(data: ArrayBuffer): void {
  loaded = parse(data);
}

export function fontLoaded(): boolean {
  return loaded !== undefined;
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
export function layoutText(content: TextContent, font: Font | undefined = loaded): TextLayout {
  if (!font) return { path: "", units: [] };
  const k = content.size / font.unitsPerEm;
  const lineHeight = content.size * 1.2;

  // Pass 1: positions along each line.
  let offset = 0;
  const lines = content.text.split("\n").map((line) => {
    let x = 0;
    let prev: Glyph | undefined;
    const chars: { index: number; x: number; adv: number; glyph: Glyph }[] = [];
    for (let i = 0; i < line.length; i++) {
      const glyph = font.charToGlyph(line[i]!);
      if (prev) x += font.getKerningValue(prev, glyph) * k;
      const adv = (glyph.advanceWidth ?? 0) * k;
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
    const baseline = font.ascender * k + li * lineHeight;
    for (const c of line.chars) {
      const x = c.x + shift;
      placed.push({ index: c.index, x, adv: c.adv, baseline, d: c.glyph.getPath(x, baseline, content.size).toPathData(2) });
    }
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
