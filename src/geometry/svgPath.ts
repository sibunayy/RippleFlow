import type { PathCmd } from "./path";

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Parse an SVG path `d` string into absolute M/L/Q/C/Z commands (arcs become cubics). */
export function parseSvgPath(d: string): PathCmd[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: PathCmd[] = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: [number, number] | null = null; // last cubic control point
  let lastQ: [number, number] | null = null; // last quad control point

  const num = () => {
    const v = Number(tokens[i++]);
    if (Number.isNaN(v)) throw new Error(`Bad SVG path near token ${i - 1}`);
    return v;
  };

  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (/[a-zA-Z]/.test(tok)) {
      cmd = tok;
      i++;
    } else if (!cmd) {
      throw new Error("SVG path must start with a command");
    }
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const n = ARGS[up];
    if (n === undefined) throw new Error(`Unsupported SVG command ${cmd}`);
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;

    if (up === "Z") {
      out.push({ t: "Z" });
      x = sx;
      y = sy;
      lastC = lastQ = null;
      continue;
    }
    const a: number[] = [];
    for (let k = 0; k < n; k++) a.push(num());

    switch (up) {
      case "M":
        x = a[0]! + ox;
        y = a[1]! + oy;
        sx = x;
        sy = y;
        out.push({ t: "M", x, y });
        cmd = rel ? "l" : "L"; // implicit lineto after moveto
        lastC = lastQ = null;
        break;
      case "L":
        x = a[0]! + ox;
        y = a[1]! + oy;
        out.push({ t: "L", x, y });
        lastC = lastQ = null;
        break;
      case "H":
        x = a[0]! + ox;
        out.push({ t: "L", x, y });
        lastC = lastQ = null;
        break;
      case "V":
        y = a[0]! + oy;
        out.push({ t: "L", x, y });
        lastC = lastQ = null;
        break;
      case "C": {
        const c = { t: "C" as const, x1: a[0]! + ox, y1: a[1]! + oy, x2: a[2]! + ox, y2: a[3]! + oy, x: a[4]! + ox, y: a[5]! + oy };
        out.push(c);
        lastC = [c.x2, c.y2];
        lastQ = null;
        x = c.x;
        y = c.y;
        break;
      }
      case "S": {
        const x1: number = lastC ? 2 * x - lastC[0] : x;
        const y1: number = lastC ? 2 * y - lastC[1] : y;
        const c: Extract<PathCmd, { t: "C" }> = { t: "C", x1, y1, x2: a[0]! + ox, y2: a[1]! + oy, x: a[2]! + ox, y: a[3]! + oy };
        out.push(c);
        lastC = [c.x2, c.y2];
        lastQ = null;
        x = c.x;
        y = c.y;
        break;
      }
      case "Q": {
        const c = { t: "Q" as const, x1: a[0]! + ox, y1: a[1]! + oy, x: a[2]! + ox, y: a[3]! + oy };
        out.push(c);
        lastQ = [c.x1, c.y1];
        lastC = null;
        x = c.x;
        y = c.y;
        break;
      }
      case "T": {
        const x1: number = lastQ ? 2 * x - lastQ[0] : x;
        const y1: number = lastQ ? 2 * y - lastQ[1] : y;
        const c: Extract<PathCmd, { t: "Q" }> = { t: "Q", x1, y1, x: a[0]! + ox, y: a[1]! + oy };
        out.push(c);
        lastQ = [x1, y1];
        lastC = null;
        x = c.x;
        y = c.y;
        break;
      }
      case "A": {
        const ex = a[5]! + ox;
        const ey = a[6]! + oy;
        out.push(...arcToCubics(x, y, a[0]!, a[1]!, a[2]!, a[3]! !== 0, a[4]! !== 0, ex, ey));
        x = ex;
        y = ey;
        lastC = lastQ = null;
        break;
      }
    }
  }
  return out;
}

/** SVG elliptical arc (endpoint form) to cubic beziers. Spec F.6.5. */
function arcToCubics(
  x1: number, y1: number, rxIn: number, ryIn: number, rotDeg: number,
  large: boolean, sweep: boolean, x2: number, y2: number,
): PathCmd[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ t: "L", x: x2, y: y2 }];
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;

  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const delta = dth / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: PathCmd[] = [];
  let th = th1;
  const pt = (a: number): [number, number, number, number] => {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return [ca, sa, -sa, ca];
  };
  for (let i = 0; i < segs; i++) {
    const [c0, s0] = pt(th);
    const [c1, s1] = pt(th + delta);
    const p = (ux: number, uy: number) => [
      cosP * rx * ux - sinP * ry * uy + cx,
      sinP * rx * ux + cosP * ry * uy + cy,
    ] as const;
    const a1 = p(c0 - t * s0, s0 + t * c0);
    const a2 = p(c1 + t * s1, s1 - t * c1);
    const e = p(c1, s1);
    out.push({ t: "C", x1: a1[0], y1: a1[1], x2: a2[0], y2: a2[1], x: e[0], y: e[1] });
    th += delta;
  }
  // Snap the final point to the exact endpoint to avoid drift.
  const last = out[out.length - 1];
  if (last && last.t === "C") {
    last.x = x2;
    last.y = y2;
  }
  return out;
}
