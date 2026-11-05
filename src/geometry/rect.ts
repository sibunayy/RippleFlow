import type { Mesh } from "./mesh";

const cache = new Map<string, Mesh>();

/** Shared two-triangle rectangle from (0,0) to (w,h); one instance per size, so equal sizes compare equal. */
export function rectMesh(w: number, h: number): Mesh {
  const key = `${w}x${h}`;
  let m = cache.get(key);
  if (!m) {
    m = { positions: new Float32Array([0, 0, w, 0, w, h, 0, h]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
    cache.set(key, m);
  }
  return m;
}
