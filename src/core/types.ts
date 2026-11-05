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

/**
 * After Effects-style layer transform. Defaults when a track has no keys:
 * anchor 0, position 0, scale 1, rotation 0, opacity 1.
 * Local matrix = translate(position) * rotate(rotation) * scale(scale) * translate(-anchor).
 */
export interface Transform {
  /** Point in the layer's own coordinates that position and rotation act on. */
  readonly anchorX: Track;
  readonly anchorY: Track;
  /** Where the anchor lands, in the parent's coordinates (or the composition if no parent). */
  readonly x: Track;
  readonly y: Track;
  /** 1 = 100%. */
  readonly scaleX: Track;
  readonly scaleY: Track;
  /** Degrees, clockwise. */
  readonly rotation: Track;
  /** 0..1. Not inherited from the parent. */
  readonly opacity: Track;
}

export type Rgba = readonly [number, number, number, number];

/** Static vector content of a shape layer (animation is on the transform). */
export interface ShapeContent {
  /** SVG path data, in the layer's local coordinates. */
  readonly path: string;
  /** Straight RGBA 0..1. Omit for no fill. */
  readonly fill?: Rgba;
  readonly stroke?: {
    readonly color: Rgba;
    readonly width: number;
    readonly join?: "miter" | "round" | "bevel";
    readonly cap?: "butt" | "round" | "square";
  };
}

export interface Layer {
  readonly id: Id;
  readonly name: string;
  readonly kind: "shape" | "image" | "video";
  readonly parent?: Id;
  readonly transform: Transform;
  /** Present on shape layers. */
  readonly shape?: ShapeContent;
  /** Seconds. The layer is visible for inPoint <= t < outPoint. Defaults: 0 and the composition duration. */
  readonly inPoint?: number;
  readonly outPoint?: number;
}

export interface Composition {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly layers: readonly Layer[];
}
