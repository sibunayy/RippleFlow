import { describe, expect, it } from "vitest";
import { displacement, warpMesh, WARP_CELLS } from "./warp";

describe("warp", () => {
  it("no pins leaves the rectangle alone", () => {
    const m = warpMesh(200, 100, []);
    expect(m.positions[0]).toBe(0);
    expect(m.positions[m.positions.length - 2]).toBeCloseTo(200);
    expect(m.positions[m.positions.length - 1]).toBeCloseTo(100);
    expect(m.indices.length).toBe(WARP_CELLS * WARP_CELLS * 6);
  });
  it("a pin moves the point under it almost fully and leaves far points nearly alone", () => {
    const pins = [{ x: 50, y: 50, dx: 40, dy: -20 }];
    const [nx, ny] = displacement(pins, 50, 50, 400, 400);
    expect(nx).toBeGreaterThan(36);
    expect(ny).toBeLessThan(-18);
    const [fx] = displacement(pins, 390, 390, 400, 400);
    expect(Math.abs(fx)).toBeLessThan(4);
  });
  it("two pins pull their own neighbourhoods", () => {
    const pins = [{ x: 0, y: 0, dx: 30, dy: 0 }, { x: 400, y: 0, dx: -30, dy: 0 }];
    expect(displacement(pins, 5, 0, 400, 400)[0]).toBeGreaterThan(20);
    expect(displacement(pins, 395, 0, 400, 400)[0]).toBeLessThan(-20);
  });
  it("keeps texture coordinates on the regular grid", () => {
    const m = warpMesh(100, 100, [{ x: 50, y: 50, dx: 30, dy: 30 }]);
    expect(m.uvs![m.uvs!.length - 2]).toBe(1);
    expect(m.uvs![m.uvs!.length - 1]).toBe(1);
  });
});
