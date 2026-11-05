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

import { packNv12Tight } from "./nv12Readback";

describe("packNv12Tight", () => {
  /** A padded readback where every byte encodes where it should end up: row, column, and plane. */
  const padded = (w: number, h: number, stride: number) => {
    const raw = new Uint8Array((stride * h * 3) / 2).fill(0xee); // 0xee = padding that must never leak through
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) raw[r * stride + c] = (r * 7 + c) & 0x7f; // Y
    for (let r = 0; r < h / 2; r++) for (let c = 0; c < w; c++) raw[stride * h + r * stride + c] = 0x80 | ((r * 5 + c) & 0x7f); // CbCr
    return raw;
  };

  it("removes row padding from both planes (1080p-like: width not a multiple of 256)", () => {
    const [w, h, stride] = [20, 8, 256];
    const out = packNv12Tight(padded(w, h, stride), stride, w, h);
    expect(out.length).toBe((w * h * 3) / 2);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) expect(out[r * w + c]).toBe((r * 7 + c) & 0x7f);
    for (let r = 0; r < h / 2; r++) for (let c = 0; c < w; c++) expect(out[w * h + r * w + c]).toBe(0x80 | ((r * 5 + c) & 0x7f));
    expect(out.includes(0xee)).toBe(false);
  });

  it("is a straight copy when there is no padding (720p-like)", () => {
    const [w, h] = [16, 4];
    const raw = padded(w, h, w);
    expect([...packNv12Tight(raw, w, w, h)]).toEqual([...raw]);
  });

  it("returns a new buffer, safe to keep after the GPU buffer is unmapped", () => {
    const raw = padded(8, 4, 256);
    const out = packNv12Tight(raw, 256, 8, 4);
    raw.fill(0);
    expect(out[0]).toBe(0);
    expect(out[9]).toBe((1 * 7 + 1) & 0x7f);
  });
});
