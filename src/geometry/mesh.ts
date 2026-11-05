/** Growable triangle mesh: 2D positions plus 32-bit indices. */
export class MeshBuilder {
  private pos: number[] = [];
  private idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 2;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  vertex(x: number, y: number): number {
    this.pos.push(x, y);
    return this.pos.length / 2 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  /** Triangle from raw points (adds 3 vertices). */
  triPoints(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
    this.tri(this.vertex(ax, ay), this.vertex(bx, by), this.vertex(cx, cy));
  }

  build(): Mesh {
    return { positions: new Float32Array(this.pos), indices: new Uint32Array(this.idx) };
  }
}

export interface Mesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Sum of absolute triangle areas. Useful for tests. */
export function meshArea(m: Mesh): number {
  let area = 0;
  const p = m.positions;
  const ix = m.indices;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]! * 2;
    const b = ix[i + 1]! * 2;
    const c = ix[i + 2]! * 2;
    area += Math.abs((p[b]! - p[a]!) * (p[c + 1]! - p[a + 1]!) - (p[c]! - p[a]!) * (p[b + 1]! - p[a + 1]!)) / 2;
  }
  return area;
}
