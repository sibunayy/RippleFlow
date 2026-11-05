/** One pointer event (or one coalesced sub-event), reduced to plain numbers. */
export interface PointerSample {
  /** "pen" | "touch" | "mouse" */
  type: string;
  id: number;
  /** event.timeStamp in ms. */
  t: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
  twist?: number;
  width: number;
  height: number;
  /** Number of coalesced events that arrived with this event (1 if unsupported). */
  coalesced: number;
}

interface Range {
  min: number;
  max: number;
}
const emptyRange = (): Range => ({ min: Infinity, max: -Infinity });
const widen = (r: Range, v: number) => {
  if (v < r.min) r.min = v;
  if (v > r.max) r.max = v;
};
const out = (r: Range) => (r.min === Infinity ? null : { min: round(r.min), max: round(r.max) });
const round = (n: number) => Math.round(n * 1000) / 1000;

interface PerType {
  moves: number;
  pressure: Range;
  pressureSum: number;
  pressureDistinct: Set<number>;
  tiltX: Range;
  tiltY: Range;
  altitude: Range;
  azimuth: Range;
  withAltitude: number;
  twistNonZero: number;
  width: Range;
  height: Range;
  coalesced: number;
  coalescedMax: number;
  lastT: Map<number, number>;
  dts: number[];
}
const newPerType = (): PerType => ({
  moves: 0, pressure: emptyRange(), pressureSum: 0, pressureDistinct: new Set(), tiltX: emptyRange(), tiltY: emptyRange(),
  altitude: emptyRange(), azimuth: emptyRange(), withAltitude: 0, twistNonZero: 0, width: emptyRange(), height: emptyRange(),
  coalesced: 0, coalescedMax: 0, lastT: new Map(), dts: [],
});

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * Accumulates pointer samples and summarizes what a device really delivers:
 * pressure resolution, tilt, contact size, event rate and coalescing. Plain
 * numbers in, plain numbers out, so it is testable without a browser.
 */
export class InputStats {
  private types = new Map<string, PerType>();
  private downs = new Map<string, number>();
  private touchDownsDuringPen = 0;

  /** Call on pointerdown. `penActive` is true if any pen pointer is currently down. */
  noteDown(type: string, penActive: boolean): void {
    this.downs.set(type, (this.downs.get(type) ?? 0) + 1);
    if (type === "touch" && penActive) this.touchDownsDuringPen++;
  }

  add(s: PointerSample): void {
    let t = this.types.get(s.type);
    if (!t) this.types.set(s.type, (t = newPerType()));
    t.moves++;
    widen(t.pressure, s.pressure);
    t.pressureSum += s.pressure;
    if (t.pressureDistinct.size < 5000) t.pressureDistinct.add(round(s.pressure));
    widen(t.tiltX, s.tiltX);
    widen(t.tiltY, s.tiltY);
    if (s.altitudeAngle !== undefined) {
      t.withAltitude++;
      widen(t.altitude, s.altitudeAngle);
    }
    if (s.azimuthAngle !== undefined) widen(t.azimuth, s.azimuthAngle);
    if (s.twist) t.twistNonZero++;
    widen(t.width, s.width);
    widen(t.height, s.height);
    t.coalesced += s.coalesced;
    t.coalescedMax = Math.max(t.coalescedMax, s.coalesced);
    const last = t.lastT.get(s.id);
    if (last !== undefined) {
      const dt = s.t - last;
      if (dt > 0 && dt < 250) t.dts.push(dt);
    }
    t.lastT.set(s.id, s.t);
  }

  summary() {
    const perType: Record<string, unknown> = {};
    for (const [type, t] of this.types) {
      const dt = median(t.dts);
      perType[type] = {
        events: t.moves,
        pointerdowns: this.downs.get(type) ?? 0,
        pressure: out(t.pressure),
        pressureMean: t.moves ? round(t.pressureSum / t.moves) : null,
        pressureDistinctValues: t.pressureDistinct.size,
        tiltX: out(t.tiltX),
        tiltY: out(t.tiltY),
        altitudeAngle: t.withAltitude ? out(t.altitude) : "not provided",
        azimuthAngle: t.withAltitude ? out(t.azimuth) : "not provided",
        twistNonZeroEvents: t.twistNonZero,
        contactWidth: out(t.width),
        contactHeight: out(t.height),
        medianEventIntervalMs: dt === null ? null : round(dt),
        approxEventHz: dt ? Math.round(1000 / dt) : null,
        coalescedPerEventMean: t.moves ? round(t.coalesced / t.moves) : null,
        coalescedPerEventMax: t.coalescedMax,
      };
    }
    return { perType, touchDownsWhilePenDown: this.touchDownsDuringPen };
  }
}
