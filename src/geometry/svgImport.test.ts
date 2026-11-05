import { describe, expect, it } from "vitest";
import { importSvg, parseColor, parseTransform } from "./svgImport";
import { parseNodes, pathBounds } from "./nodes";

describe("svg import", () => {
  it("reads size, shapes, colours and bakes group transforms", () => {
    const r = importSvg(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <g transform="translate(10 20)" fill="#ff0000"><rect x="0" y="0" width="50" height="30"/>
      <circle cx="100" cy="50" r="10" fill="blue" stroke="#fff" stroke-width="4"/></g></svg>`);
    expect([r.width, r.height]).toEqual([200, 100]);
    expect(r.shapes).toHaveLength(2);
    expect(r.shapes[0]!.fill).toEqual([1, 0, 0, 1]);
    const b = pathBounds(parseNodes(r.shapes[0]!.path))!;
    expect([b.x, b.y, b.w, b.h]).toEqual([10, 20, 50, 30]);
    expect(r.shapes[1]!.fill).toEqual([0, 0, 1, 1]);
    expect(r.shapes[1]!.stroke!.width).toBe(4);
  });
  it("applies viewBox origin, css classes and style attributes", () => {
    const r = importSvg(`<svg viewBox="10 10 100 100"><style>.a{fill:#00ff00;stroke:#000;stroke-width:2}</style>
      <path class="a" d="M10 10 L110 10 L110 110 Z"/><path d="M10 10h5v5z" style="fill:rgb(255,0,0);opacity:.5"/></svg>`);
    expect(r.shapes[0]!.fill).toEqual([0, 1, 0, 1]);
    expect(r.shapes[0]!.stroke!.width).toBe(2);
    expect(pathBounds(parseNodes(r.shapes[0]!.path))!.x).toBe(0);
    expect(r.shapes[1]!.fill).toEqual([1, 0, 0, 0.5]);
  });
  it("scales stroke width by the transform and skips unsupported things", () => {
    const r = importSvg(`<svg width="10" height="10"><defs><linearGradient id="g"/></defs>
      <g transform="scale(3)"><line x1="0" y1="0" x2="5" y2="5" stroke="red" stroke-width="2"/></g>
      <rect width="4" height="4" fill="url(#g)"/><text>hi</text><rect width="4" height="4" display="none"/></svg>`);
    expect(r.shapes).toHaveLength(2);
    expect(r.shapes[0]!.stroke!.width).toBeCloseTo(6);
    expect(r.shapes[0]!.fill).toBeUndefined(); // a line has no area to fill
  });
  it("rejects non-svg", () => {
    expect(() => importSvg("<html></html>")).toThrow();
  });
  it("parses colours and transforms", () => {
    expect(parseColor("#f00")).toEqual([1, 0, 0, 1]);
    expect(parseColor("none")).toBe("none");
    expect(parseColor("bogus")).toBeNull();
    expect(parseTransform("translate(5) scale(2)")).toEqual([2, 0, 0, 2, 5, 0]);
  });
});
