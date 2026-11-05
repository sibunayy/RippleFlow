import type { Mesh } from "./mesh";

/** A pin resolved at one instant: rest position plus how far it has been pulled. */
export interface ResolvedPin {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

/** Grid cells per side. 24 x 24 is smooth enough for character-sized pulls and cheap to rebuild every frame. */
export const WARP_CELLS = 24;

/**
 * Displacement of the point (x, y): an inverse-distance blend of the pins' offsets, with a faint
 * "stay put" weight so points far from every pin do not drift with the average.
 */
export function displacement(pins: readonly ResolvedPin[], x: number, y: number, w: number, h: number): [number, number] {
  const diag = Math.hypot(w, h);
  const soft = 0.04 * diag; // inside this radius a pin owns the point
  const wRest = 1 / (0.35 * diag) ** 3; // weight of "no displacement"
  let sw = wRest;
  let sx = 0;
  let sy = 0;
  for (const p of pins) {
    const r2 = (x - p.x) ** 2 + (y - p.y) ** 2;
    const k = 1 / (r2 + soft * soft) ** 1.5;
    sw += k;
    sx += k * p.dx;
    sy += k * p.dy;
  }
  return [sx / sw, sy / sw];
}

let sharedIndices: Uint32Array | undefined;
function gridIndices(): Uint32Array {
  if (sharedIndices) return sharedIndices;
  const n = WARP_CELLS;
  const out = new Uint32Array(n * n * 6);
  let o = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      out.set([a, b, c, b, d, c], o);
      o += 6;
    }
  return (sharedIndices = out);
}

/**
 * The picture as a grid whose vertices are pulled by the pins. Texture coordinates stay on the regular grid,
 * so the picture itself is carried along. With no pins this is just the picture rectangle.
 */
export function warpMesh(w: number, h: number, pins: readonly ResolvedPin[]): Mesh {
  const n = WARP_CELLS;
  const positions = new Float32Array((n + 1) * (n + 1) * 2);
  const uvs = new Float32Array(positions.length);
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const v = j / n;
      const [dx, dy] = displacement(pins, u * w, v * h, w, h);
      const k = (j * (n + 1) + i) * 2;
      positions[k] = u * w + dx;
      positions[k + 1] = v * h + dy;
      uvs[k] = u;
      uvs[k + 1] = v;
    }
  return { positions, uvs, indices: gridIndices() };
}
