import { describe, expect, it } from "vitest";
import { pathLength, trimSubpaths } from "./trim";

const line = { points: [0, 0, 100, 0], closed: false };
const square = { points: [0, 0, 100, 0, 100, 100, 0, 100], closed: true };

describe("trim", () => {
  it("measures open and closed lengths", () => {
    expect(pathLength([line])).toBe(100);
    expect(pathLength([square])).toBe(400);
  });
  it("keeps the requested fraction of a line", () => {
    const [t] = trimSubpaths([line], 0.25, 0.75);
    expect(t!.points).toEqual([25, 0, 75, 0]);
    expect(t!.closed).toBe(false);
  });
  it("opens a partly trimmed closed shape and walks around corners", () => {
    const [t] = trimSubpaths([square], 0, 0.625);
    expect(t!.closed).toBe(false);
    expect(t!.points).toEqual([0, 0, 100, 0, 100, 100, 50, 100]);
  });
  it("full range keeps closed shapes closed; empty range gives nothing", () => {
    expect(trimSubpaths([square], 0, 1)[0]!.closed).toBe(true);
    expect(trimSubpaths([square], 0.5, 0.5)).toEqual([]);
    expect(trimSubpaths([square], 0.8, 0.2)).toEqual([]);
  });
  it("spreads the range across subpaths in order", () => {
    const two = [line, { points: [0, 10, 100, 10], closed: false }];
    const out = trimSubpaths(two, 0.25, 0.75);
    expect(out).toHaveLength(2);
    expect(out[0]!.points).toEqual([50, 0, 100, 0]);
    expect(out[1]!.points).toEqual([0, 10, 50, 10]);
  });
});
