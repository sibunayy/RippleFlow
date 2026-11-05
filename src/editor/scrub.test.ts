import { describe, expect, it } from "vitest";
import { scrubValue } from "./scrub";

describe("scrubValue", () => {
  it("moves by perPx per pixel", () => expect(scrubValue(10, 20, 0, { perPx: 0.5 })).toBe(20));
  it("goes negative with leftward drags", () => expect(scrubValue(10, -20, 0, { perPx: 1 })).toBe(-10));
  it("clamps to min and max", () => {
    expect(scrubValue(50, 500, 0, { perPx: 1, max: 100 })).toBe(100);
    expect(scrubValue(50, -500, 0, { perPx: 1, min: 0 })).toBe(0);
  });
  it("is ten times finer when dragged far away vertically", () => expect(scrubValue(0, 100, 90, { perPx: 1 })).toBe(10));
  it("rounds to the requested decimals", () => expect(scrubValue(0, 1, 0, { perPx: 0.123456, decimals: 2 })).toBe(0.12));
});
