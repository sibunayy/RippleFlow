import { apply, IDENTITY, invert, maxScale, multiply, type Affine } from "../core/affine";
import { InputStats, type PointerSample } from "../input/pointerStats";
import { TwoFingerGesture } from "../input/twoFingerGesture";

declare global {
  interface Window {
    __input?: { results: () => unknown; view: () => Affine; strokes: () => number };
  }
}

type AngleFields = { altitudeAngle?: number; azimuthAngle?: number; twist?: number };

const canvas = document.getElementById("c") as HTMLCanvasElement;
const hud = document.getElementById("hud")!;
const sheet = document.getElementById("sheet")!;
const ctx = canvas.getContext("2d")!;

const stats = new InputStats();
const gesture = new TwoFingerGesture();
let view: Affine = IDENTITY;
let maxZoom = 1;
let minZoom = 1;
let totalRotationDeg = 0;

interface Stroke {
  pts: Array<{ x: number; y: number; p: number }>;
  type: string;
}
const strokes: Stroke[] = [];
const active = new Map<number, Stroke>(); // pointer id -> stroke being drawn
const penDown = new Set<number>();
let anomalies = 0;
const handlerDelay: number[] = [];
const toFrame: number[] = [];
let lastEvent: PointerEvent | null = null;
let pendingFrameStamp: number | null = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  schedule();
}
window.addEventListener("resize", resize);

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame((ts) => {
    scheduled = false;
    draw();
    if (pendingFrameStamp !== null) {
      const d = ts - pendingFrameStamp;
      if (d >= 0 && d < 1000) toFrame.push(d);
      else anomalies++;
      pendingFrameStamp = null;
    }
    updateHud();
  });
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const [a, b, c, d, e, f] = view;
  ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = s.type === "pen" ? "#ffd84a" : "#7fe3ff";
    for (let i = 1; i < s.pts.length; i++) {
      const p0 = s.pts[i - 1]!;
      const p1 = s.pts[i]!;
      ctx.lineWidth = 2 + 10 * p1.p;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }
}

function toWorld(x: number, y: number): { x: number; y: number } {
  const inv = invert(view);
  const [wx, wy] = inv ? apply(inv, x, y) : [x, y];
  return { x: wx, y: wy };
}

const f2 = (n: number | undefined) => (n === undefined ? "n/a" : n.toFixed(2));

function updateHud() {
  const e = lastEvent;
  const z = maxScale(view);
  hud.textContent =
    (e
      ? `${e.pointerType}  pressure ${f2(e.pressure)}  tilt ${e.tiltX},${e.tiltY}\n` +
        `altitude ${f2((e as AngleFields & PointerEvent).altitudeAngle)}  azimuth ${f2((e as AngleFields & PointerEvent).azimuthAngle)}  twist ${e.twist}\n` +
        `contact ${f2(e.width)}x${f2(e.height)}  buttons ${e.buttons}\n`
      : "Draw with the Pencil. Two fingers pan, zoom and rotate.\n") +
    `zoom ${z.toFixed(2)}  strokes ${strokes.length}  pen down ${penDown.size}`;
}

function sampleOf(e: PointerEvent, coalesced: number): PointerSample {
  const a = e as AngleFields & PointerEvent;
  return {
    type: e.pointerType, id: e.pointerId, t: e.timeStamp, pressure: e.pressure, tiltX: e.tiltX, tiltY: e.tiltY,
    ...(a.altitudeAngle !== undefined ? { altitudeAngle: a.altitudeAngle } : {}),
    ...(a.azimuthAngle !== undefined ? { azimuthAngle: a.azimuthAngle } : {}),
    twist: e.twist, width: e.width, height: e.height, coalesced,
  };
}

const draws = (type: string) => type === "pen" || type === "mouse";

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  stats.noteDown(e.pointerType, penDown.size > 0);
  lastEvent = e;
  if (e.pointerType === "pen") penDown.add(e.pointerId);
  if (draws(e.pointerType)) {
    const w = toWorld(e.offsetX, e.offsetY);
    const s: Stroke = { type: e.pointerType, pts: [{ ...w, p: e.pressure }] };
    strokes.push(s);
    active.set(e.pointerId, s);
  } else {
    gesture.down(e.pointerId, e.clientX, e.clientY);
  }
  schedule();
});

canvas.addEventListener("pointermove", (e) => {
  lastEvent = e;
  const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
  const events = list.length > 0 ? list : [e];
  for (const ev of events) stats.add(sampleOf(ev, events.length));

  const hd = performance.now() - e.timeStamp;
  if (hd >= 0 && hd < 1000) handlerDelay.push(hd);
  else anomalies++;
  pendingFrameStamp = e.timeStamp;

  const s = active.get(e.pointerId);
  if (s) {
    for (const ev of events) {
      const w = toWorld(ev.offsetX, ev.offsetY);
      s.pts.push({ ...w, p: ev.pressure });
    }
  } else if (e.pointerType === "touch") {
    const delta = gesture.move(e.pointerId, e.clientX, e.clientY);
    if (delta) {
      view = multiply(delta, view);
      const z = maxScale(view);
      maxZoom = Math.max(maxZoom, z);
      minZoom = Math.min(minZoom, z);
      totalRotationDeg += (Math.atan2(delta[1], delta[0]) * 180) / Math.PI;
    }
  }
  schedule();
});

function end(e: PointerEvent) {
  active.delete(e.pointerId);
  penDown.delete(e.pointerId);
  gesture.up(e.pointerId);
  schedule();
}
canvas.addEventListener("pointerup", end);
canvas.addEventListener("pointercancel", (e) => {
  anomalies++; // a cancel mid-stroke usually means the system took over the touch
  end(e);
});

// Stop the browser's own gestures, menus and selection from stealing input.
for (const ev of ["contextmenu", "selectstart", "gesturestart", "gesturechange", "dragstart"]) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false } as AddEventListenerOptions);
}

function q(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 100) / 100;
  return { n: s.length, median: at(0.5), p95: at(0.95), max: at(1) };
}

function results() {
  const nav = navigator as Navigator & { standalone?: boolean };
  const mq = (s: string) => window.matchMedia(s).matches;
  return {
    env: {
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
      screen: `${screen.width}x${screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      standalone: nav.standalone ?? mq("(display-mode: standalone)"),
      maxTouchPoints: navigator.maxTouchPoints,
      api: {
        coalescedEvents: typeof PointerEvent !== "undefined" && "getCoalescedEvents" in PointerEvent.prototype,
        predictedEvents: typeof PointerEvent !== "undefined" && "getPredictedEvents" in PointerEvent.prototype,
        pointerrawupdate: "onpointerrawupdate" in window,
        gestureEvents: "ongesturestart" in window,
        touchEvents: "ontouchstart" in window,
        altitudeAzimuthOnEvent: typeof PointerEvent !== "undefined" && "altitudeAngle" in PointerEvent.prototype,
      },
      media: { pointerFine: mq("(pointer: fine)"), anyPointerFine: mq("(any-pointer: fine)"), hover: mq("(hover: hover)"), anyHover: mq("(any-hover: hover)") },
    },
    input: stats.summary(),
    latencyMs: { handlerDelay: q(handlerDelay), eventToFrame: q(toFrame), anomalies },
    gesture: { maxZoom: Math.round(maxZoom * 100) / 100, minZoom: Math.round(minZoom * 100) / 100, totalRotationDeg: Math.round(totalRotationDeg) },
    strokes: strokes.length,
  };
}

document.getElementById("clear")!.addEventListener("click", () => {
  strokes.length = 0;
  active.clear();
  schedule();
});
document.getElementById("reset")!.addEventListener("click", () => {
  view = IDENTITY;
  schedule();
});
document.getElementById("results")!.addEventListener("click", async () => {
  const text = JSON.stringify(results(), null, 1);
  sheet.style.display = sheet.style.display === "block" ? "none" : "block";
  sheet.textContent = text;
  try {
    await navigator.clipboard.writeText(text);
    sheet.textContent = "(copied to clipboard)\n" + text;
  } catch {
    /* clipboard may need a secure context or permission; the text is on screen */
  }
});

window.__input = { results, view: () => view, strokes: () => strokes.length };
resize();
