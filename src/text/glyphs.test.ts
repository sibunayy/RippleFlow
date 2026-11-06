import { parseSvgPath } from "../geometry/svgPath";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { fontLoaded, layoutText, setFontData } from "./glyphs";
import { DEFAULT_ANIMATOR, textUnits, unitStates } from "../core/text";
import { buildLayerGeometry } from "../geometry/layerGeometry";
import { evaluateScene } from "../core/scene";
import type { Composition, Layer, TextContent } from "../core/types";

const content = (over: Partial<TextContent> = {}): TextContent => ({ text: "Hi you", size: 100, tracking: 0, align: "left", ...over });

beforeAll(() => {
  const b = readFileSync(new URL("./fonts/Inter-Bold.ttf", import.meta.url));
  setFontData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
});

describe("textUnits", () => {
  it("splits characters (no spaces), words and lines", () => {
    expect(textUnits("ab c\nd", "char")).toHaveLength(4);
    expect(textUnits("ab c\nd", "word").map((r) => [r.start, r.end])).toEqual([[0, 2], [3, 4], [5, 6]]);
    expect(textUnits("ab c\n\nd", "line").map((r) => [r.start, r.end])).toEqual([[0, 4], [6, 7]]);
  });
});

describe("unitStates", () => {
  it("staggers units and settles at rest", () => {
    const s = unitStates(DEFAULT_ANIMATOR, 3, 0.05);
    expect(s[0]!.opacity).toBeGreaterThan(s[1]!.opacity);
    expect(s[2]!.opacity).toBe(0);
    expect(unitStates(DEFAULT_ANIMATOR, 3, 10).every((u) => u.opacity === 1 && u.dy === 0 && u.scale === 1)).toBe(true);
  });
  it("negative stagger starts from the last unit", () => {
    const s = unitStates({ ...DEFAULT_ANIMATOR, stagger: -0.05 }, 3, 0.05);
    expect(s[2]!.opacity).toBeGreaterThan(s[0]!.opacity);
  });
});

describe("layoutText", () => {
  it("draws outlines and one unit per character/word/line", () => {
    expect(layoutText(content()).path).toContain("M");
    expect(layoutText(content({ animator: { ...DEFAULT_ANIMATOR, unit: "char" } })).units).toHaveLength(5);
    expect(layoutText(content({ animator: { ...DEFAULT_ANIMATOR, unit: "word" } })).units).toHaveLength(2);
    expect(layoutText(content({ text: "a\nb", animator: { ...DEFAULT_ANIMATOR, unit: "line" } })).units).toHaveLength(2);
  });
  it("tracking widens and alignment shifts", () => {
    const x = (c: TextContent) => Number(layoutText({ ...c, animator: DEFAULT_ANIMATOR }).units.at(-1)!.pivot[0]);
    expect(x(content({ tracking: 20 }))).toBeGreaterThan(x(content()));
    const two = (align: TextContent["align"]) => layoutText({ ...content({ text: "iiiiii\ni", align }), animator: { ...DEFAULT_ANIMATOR, unit: "line" } }).units[1]!.pivot[0];
    expect(two("right")).toBeGreaterThan(two("left"));
    expect(two("center")).toBeGreaterThan(two("left"));
  });
});

describe("animated text geometry and scene", () => {
  const layer = (text: TextContent): Layer => ({
    id: "t", name: "T", kind: "shape", text,
    shape: { path: layoutText(text).path, fill: [1, 1, 1, 1] },
    transform: { anchorX: { keys: [] }, anchorY: { keys: [] }, x: { keys: [] }, y: { keys: [] }, scaleX: { keys: [] }, scaleY: { keys: [] }, rotation: { keys: [] }, opacity: { keys: [] } },
  });
  it("builds one part per character, tagged with its unit", () => {
    const g = buildLayerGeometry(layer(content({ animator: DEFAULT_ANIMATOR })), () => undefined)!;
    expect(g.parts.map((p) => p.unit)).toEqual([0, 1, 2, 3, 4]);
    expect(g.bounds!.w).toBeGreaterThan(100);
  });
  it("evaluateScene carries per-unit states only for animated text", () => {
    const comp = (l: Layer): Composition => ({ width: 100, height: 100, fps: 30, duration: 2, layers: [l] });
    expect(evaluateScene(comp(layer(content({ animator: DEFAULT_ANIMATOR }))), 0.1)[0]!.units).toHaveLength(5);
    expect(evaluateScene(comp(layer(content())), 0.1)[0]!.units).toBeUndefined();
  });
});

describe("pathData", () => {
  it("never emits NaN where opentype toPathData does (Pacifico R at baseline 130.3)", () => {
    const b = readFileSync(new URL("./fonts/Pacifico-Regular.woff", import.meta.url));
    setFontData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "pacifico");
    const p = layoutText(content({ text: "Rag", font: "pacifico" })).path;
    expect(p).not.toMatch(/NaN/);
    expect(() => parseSvgPath(p)).not.toThrow();
  });
});

describe("multiple fonts", () => {
  it("lays out with the font named by content.font and parses WOFF", () => {
    for (const [id, file] of [["poppins", "Poppins-Bold.woff"], ["bebas", "BebasNeue-Regular.woff"], ["playfair", "PlayfairDisplay-Bold.woff"], ["pacifico", "Pacifico-Regular.woff"], ["spacemono", "SpaceMono-Bold.woff"]] as const) {
      const b = readFileSync(new URL(`./fonts/${file}`, import.meta.url));
      setFontData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, id);
      expect(fontLoaded(id)).toBe(true);
    }
    const paths = [undefined, "poppins", "bebas", "playfair", "pacifico", "spacemono"].map((f) => layoutText(content({ text: "Rag", ...(f ? { font: f } : {}) })).path);
    expect(paths.every((p) => p.length > 0)).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it("lays out nothing for a font that is not loaded", () => {
    expect(layoutText(content({ font: "nope" })).path).toBe("");
  });
});
