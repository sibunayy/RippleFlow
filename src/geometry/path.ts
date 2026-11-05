/** Vector path types and flattening. Pure geometry: no DOM or GPU. */

export type PathCmd =
  | { t: "M"; x: number; y: number }
  | { t: "L"; x: number; y: number }
  | { t: "Q"; x1: number; y1: number; x: number; y: number }
  | { t: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: "Z" };

export interface Subpath {
  /** Flat [x0, y0, x1, y1, ...]. For closed subpaths the last point is NOT repeated. */
  points: number[];
  closed: boolean;
}

/** Convert curves to polylines. `tolerance` is the max deviation in path units. */
export function flatten(path: readonly PathCmd[], tolerance = 0.1): Subpath[] {
  const out: Subpath[] = [];
  let cur: number[] | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const push = (x: number, y: number) => {
    if (!cur) return;
    const n = cur.length;
    if (n >= 2 && cur[n - 2] === x && cur[n - 1] === y) return;
    cur.push(x, y);
  };
  const finish = (closed: boolean) => {
    if (cur && cur.length >= 4) {
      if (closed && cur.length > 4) {
        const n = cur.length;
        if (cur[0] === cur[n - 2] && cur[1] === cur[n - 1]) cur.length = n - 2;
      }
      out.push({ points: cur, closed });
    }
    cur = null;
  };

  for (const c of path) {
    switch (c.t) {
      case "M":
        finish(false);
        cur = [c.x, c.y];
        cx = sx = c.x;
        cy = sy = c.y;
        break;
      case "L":
        if (!cur) cur = [cx, cy];
        push(c.x, c.y);
        cx = c.x;
        cy = c.y;
        break;
      case "Q": {
        if (!cur) cur = [cx, cy];
        const dd = Math.hypot(cx - 2 * c.x1 + c.x, cy - 2 * c.y1 + c.y);
        const n = Math.max(1, Math.ceil(Math.sqrt((0.25 * dd) / tolerance)));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          push(
            u * u * cx + 2 * u * t * c.x1 + t * t * c.x,
            u * u * cy + 2 * u * t * c.y1 + t * t * c.y,
          );
        }
        cx = c.x;
        cy = c.y;
        break;
      }
      case "C": {
        if (!cur) cur = [cx, cy];
        const dd = Math.max(
          Math.hypot(cx - 2 * c.x1 + c.x2, cy - 2 * c.y1 + c.y2),
          Math.hypot(c.x1 - 2 * c.x2 + c.x, c.y1 - 2 * c.y2 + c.y),
        );
        const n = Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / tolerance)));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          const a = u * u * u;
          const b = 3 * u * u * t;
          const d = 3 * u * t * t;
          const e = t * t * t;
          push(
            a * cx + b * c.x1 + d * c.x2 + e * c.x,
            a * cy + b * c.y1 + d * c.y2 + e * c.y,
          );
        }
        cx = c.x;
        cy = c.y;
        break;
      }
      case "Z":
        finish(true);
        cx = sx;
        cy = sy;
        break;
    }
  }
  finish(false);
  return out;
}
