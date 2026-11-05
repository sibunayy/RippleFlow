import { describe, expect, it } from "vitest";
import { rgbToYuv709Limited } from "./nv12Readback";

describe("rgbToYuv709Limited", () => {
  it("maps black and white to the limited-range extremes", () => {
    expect(rgbToYuv709Limited(0, 0, 0)).toEqual([16, 128, 128]);
    expect(rgbToYuv709Limited(255, 255, 255)).toEqual([235, 128, 128]);
  });
  it("greys stay neutral", () => {
    const [, cb, cr] = rgbToYuv709Limited(128, 128, 128);
    expect([cb, cr]).toEqual([128, 128]);
  });
  it("matches published BT.709 values for the primaries", () => {
    // ITU-R BT.709 limited range: red (63, 102, 240), green (173, 42, 26), blue (32, 240, 118)
    expect(rgbToYuv709Limited(255, 0, 0)).toEqual([63, 102, 240]);
    expect(rgbToYuv709Limited(0, 255, 0)).toEqual([173, 42, 26]);
    expect(rgbToYuv709Limited(0, 0, 255)).toEqual([32, 240, 118]);
  });
  it("stays inside the legal ranges for every corner of the RGB cube", () => {
    for (const r of [0, 255]) for (const g of [0, 255]) for (const b of [0, 255]) {
      const [y, cb, cr] = rgbToYuv709Limited(r, g, b);
      expect(y).toBeGreaterThanOrEqual(16);
      expect(y).toBeLessThanOrEqual(235);
      for (const c of [cb, cr]) {
        expect(c).toBeGreaterThanOrEqual(16);
        expect(c).toBeLessThanOrEqual(240);
      }
    }
  });
});
