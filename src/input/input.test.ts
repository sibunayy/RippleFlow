import { describe, expect, it } from "vitest";
import { apply, multiply } from "../core/affine";
import { InputStats, type PointerSample } from "./pointerStats";
import { TwoFingerGesture } from "./twoFingerGesture";

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe("TwoFingerGesture", () => {
  it("does nothing with one pointer", () => {
    const g = new TwoFingerGesture();
    g.down(1, 0, 0);
    expect(g.active).toBe(false);
    expect(g.move(1, 10, 10)).toBeNull();
  });
  it("pans when both fingers move together (steps arrive one finger at a time and compose)", () => {
    const g = new TwoFingerGesture();
    g.down(1, 0, 0);
    g.down(2, 100, 0);
    const d1 = g.move(1, 10, 5)!;
    const d2 = g.move(2, 110, 5)!;
    const total = multiply(d2, d1);
    close(apply(total, 0, 0), [10, 5]);
    close(apply(total, 100, 0), [110, 5]);
    close(apply(total, 37, 11), [47, 16]); // any point just translates
  });
  it("zooms about the midpoint when fingers spread", () => {
    const g = new TwoFingerGesture();
    g.down(1, 0, 0);
    g.down(2, 100, 0);
    const d = g.move(2, 200, 0)!; // distance doubles, centroid moves from 50 to 100
    close(apply(d, 0, 0), [0, 0]); // finger 1 stays put
    close(apply(d, 100, 0), [200, 0]); // finger 2's old position lands on its new one
  });
  it("rotates: a quarter turn of the finger pair", () => {
    const g = new TwoFingerGesture();
    g.down(1, -50, 0);
    g.down(2, 50, 0);
    const d1 = g.move(1, 0, -50)!;
    const d2 = g.move(2, 0, 50)!;
    const total = multiply(d2, d1);
    // Old pair (-50,0),(50,0) maps onto the new pair (0,-50),(0,50).
    close(apply(total, -50, 0), [0, -50]);
    close(apply(total, 50, 0), [0, 50]);
    // A point between them stays between them.
    close(apply(total, 0, 0), [0, 0]);
  });
  it("resets cleanly when a finger lifts and another lands", () => {
    const g = new TwoFingerGesture();
    g.down(1, 0, 0);
    g.down(2, 100, 0);
    g.up(2);
    expect(g.active).toBe(false);
    g.down(3, 500, 500);
    expect(g.active).toBe(true);
    // No jump: baseline is the current positions, so an unchanged pair gives identity-like motion.
    const d = g.move(3, 500, 500);
    expect(d).not.toBeNull();
    close(apply(d!, 123, 45), [123, 45]);
  });
  it("ignores a third pointer", () => {
    const g = new TwoFingerGesture();
    g.down(1, 0, 0);
    g.down(2, 10, 0);
    g.down(3, 99, 99);
    expect(g.move(3, 5, 5)).toBeNull();
  });
});

const sample = (o: Partial<PointerSample> = {}): PointerSample => ({
  type: "pen", id: 1, t: 0, pressure: 0.5, tiltX: 0, tiltY: 0, width: 1, height: 1, coalesced: 1, ...o,
});

describe("InputStats", () => {
  it("reports pressure range, distinct levels and tilt", () => {
    const s = new InputStats();
    [0.1, 0.3, 0.3, 0.9].forEach((p, i) => s.add(sample({ pressure: p, tiltX: i * 10, t: i * 8 })));
    const pen = s.summary().perType["pen"] as Record<string, unknown>;
    expect(pen["pressure"]).toEqual({ min: 0.1, max: 0.9 });
    expect(pen["pressureDistinctValues"]).toBe(3);
    expect(pen["tiltX"]).toEqual({ min: 0, max: 30 });
  });
  it("estimates event rate from the median interval per pointer", () => {
    const s = new InputStats();
    for (let i = 0; i < 20; i++) s.add(sample({ t: i * 8.333 }));
    expect((s.summary().perType["pen"] as { approxEventHz: number }).approxEventHz).toBe(120);
  });
  it("does not mix intervals across pointer ids", () => {
    const s = new InputStats();
    s.add(sample({ id: 1, t: 0 }));
    s.add(sample({ id: 2, t: 5 }));
    s.add(sample({ id: 1, t: 16 }));
    expect((s.summary().perType["pen"] as { medianEventIntervalMs: number }).medianEventIntervalMs).toBe(16);
  });
  it("notes when altitude and azimuth are not provided", () => {
    const s = new InputStats();
    s.add(sample());
    expect((s.summary().perType["pen"] as { altitudeAngle: unknown }).altitudeAngle).toBe("not provided");
  });
  it("counts touch pointerdowns while the pen is down (palm contact)", () => {
    const s = new InputStats();
    s.noteDown("touch", true);
    s.noteDown("touch", false);
    s.noteDown("pen", false);
    expect(s.summary().touchDownsWhilePenDown).toBe(1);
  });
  it("tracks coalescing", () => {
    const s = new InputStats();
    s.add(sample({ coalesced: 1 }));
    s.add(sample({ coalesced: 3, t: 8 }));
    const pen = s.summary().perType["pen"] as { coalescedPerEventMean: number; coalescedPerEventMax: number };
    expect(pen.coalescedPerEventMean).toBe(2);
    expect(pen.coalescedPerEventMax).toBe(3);
  });
});
