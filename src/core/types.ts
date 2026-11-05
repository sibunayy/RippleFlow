/** Pure document model: no DOM, GPU or browser dependencies. */

export type Id = string;

/** Cubic bezier easing handles, CSS-style (x1, y1, x2, y2). */
export type Bezier = readonly [number, number, number, number];

export interface Keyframe {
  readonly id: Id;
  /** Time in seconds. */
  readonly t: number;
  readonly value: number;
  /** Easing for the segment that starts at this keyframe. Omit for linear. */
  readonly ease?: Bezier;
}

export interface Track {
  readonly keys: readonly Keyframe[];
}

export interface Transform {
  readonly x: Track;
  readonly y: Track;
  readonly rotation: Track;
  readonly scale: Track;
  readonly opacity: Track;
}

export interface Layer {
  readonly id: Id;
  readonly name: string;
  readonly kind: "shape" | "image" | "video";
  readonly parent?: Id;
  readonly transform: Transform;
}

export interface Composition {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly layers: readonly Layer[];
}
