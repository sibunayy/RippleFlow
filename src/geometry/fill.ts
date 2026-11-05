import earcut from "earcut";
import { MeshBuilder, type Mesh } from "./mesh";
import type { Subpath } from "./path";

function pointInRing(x: number, y: number, ring: readonly number[]): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!;
    const yi = ring[i * 2 + 1]!;
    const xj = ring[j * 2]!;
    const yj = ring[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Triangulate subpaths using the even-odd fill rule, via nesting depth:
 * rings at even depth are outlines, rings at odd depth are holes in their parent.
 * Open subpaths are filled as if closed (SVG behaviour).
 *
 * Limitation (spike): self-intersecting rings and rings that touch or cross each
 * other are not handled; each ring must be simple.
 */
export function tessellateFill(subpaths: readonly Subpath[]): Mesh {
  const rings = subpaths.map((s) => s.points).filter((p) => p.length >= 6);
  const depth = rings.map((r, i) => {
    let d = 0;
    for (let j = 0; j < rings.length; j++) {
      if (j !== i && pointInRing(r[0]!, r[1]!, rings[j]!)) d++;
    }
    return d;
  });

  const mb = new MeshBuilder();
  rings.forEach((outer, i) => {
    if (depth[i]! % 2 !== 0) return;
    const holes: number[][] = [];
    rings.forEach((r, j) => {
      if (depth[j] === depth[i]! + 1 && pointInRing(r[0]!, r[1]!, outer)) holes.push(r);
    });
    const flat: number[] = [...outer];
    const holeIdx: number[] = [];
    for (const h of holes) {
      holeIdx.push(flat.length / 2);
      flat.push(...h);
    }
    const base = mb.vertexCount;
    for (let k = 0; k < flat.length; k += 2) mb.vertex(flat[k]!, flat[k + 1]!);
    const tris = earcut(flat, holeIdx, 2);
    for (let k = 0; k < tris.length; k += 3) mb.tri(base + tris[k]!, base + tris[k + 1]!, base + tris[k + 2]!);
  });
  return mb.build();
}
