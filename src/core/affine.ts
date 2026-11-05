/**
 * 2D affine transform [a, b, c, d, e, f], mapping a point (x, y) to
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 * Coordinates are y-down (screen space), so positive rotation is clockwise.
 */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** Combined transform that applies `second` first, then `first` (matrix product first * second). */
export function multiply(first: Affine, second: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Affine => [sx, 0, 0, sy, 0, 0];
export const rotate = (radians: number): Affine => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, s, -s, c, 0, 0];
};

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Inverse transform, or null if the matrix is singular (e.g. scale of 0). */
export function invert(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/** Largest stretch this transform applies to any direction (for tessellation tolerance). */
export function maxScale(m: Affine): number {
  const [a, b, c, d] = m;
  // Largest singular value of the 2x2 part.
  const p = a * a + b * b + c * c + d * d;
  const q = Math.abs(a * d - b * c);
  return Math.sqrt((p + Math.sqrt(Math.max(0, p * p - 4 * q * q))) / 2);
}
