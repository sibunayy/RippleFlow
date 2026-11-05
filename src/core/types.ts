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

export type EffectType =
  | "blur"
  | "dropShadow"
  | "glow"
  | "noise"
  | "levels"
  | "brightnessContrast"
  | "exposure"
  | "hueSaturation"
  | "tint"
  | "invert"
  | "posterize";

/** A non-destructive effect on a layer. Numbers are tracks, so they can be keyframed like transforms. */
export interface Effect {
  readonly id: Id;
  readonly type: EffectType;
  /** Defaults to on. */
  readonly enabled?: boolean;
  readonly values: Readonly<Record<string, Track>>;
  readonly color?: Rgba;
}

export type MaskMode = "add" | "subtract" | "intersect";

/** A vector mask: only the area inside (or outside, when inverted) shows. Masks combine in order. */
export interface Mask {
  readonly id: Id;
  /** SVG path data in the layer's own coordinates. */
  readonly path: string;
  readonly mode: MaskMode;
  /** Edge softness, composition units. */
  readonly feather: number;
  /** 0..1. */
  readonly opacity: number;
  readonly inverted?: boolean;
}

export type MatteMode = "alpha" | "alphaInverted" | "luma" | "lumaInverted";

/** Another layer's shape or brightness decides where this layer shows. */
export interface Matte {
  readonly source: Id;
  readonly mode: MatteMode;
}

/** How a layer's colours combine with what is behind it. Only modes the GPU's fixed blend stage can do exactly. */
export type BlendMode = "normal" | "multiply" | "screen" | "add";
export const BLEND_MODES: readonly BlendMode[] = ["normal", "multiply", "screen", "add"];

export interface GradientStop {
  /** 0..1 along the gradient. */
  readonly offset: number;
  /** Straight RGBA 0..1. */
  readonly color: Rgba;
}

/**
 * Gradient laid over the fill's bounding box. Linear: `angle` is in degrees
 * clockwise from left-to-right (90 = top to bottom). Radial: centred, reaching the corners.
 */
export interface Gradient {
  readonly kind: "linear" | "radial";
  readonly angle: number;
  /** 2 to 8 stops, ascending by offset. */
  readonly stops: readonly GradientStop[];
}

export const MAX_GRADIENT_STOPS = 8;

/** Static vector content of a shape layer (animation is on the transform). */
export interface ShapeContent {
  /** SVG path data, in the layer's local coordinates. */
  readonly path: string;
  /** Straight RGBA 0..1. Omit for no fill. */
  readonly fill?: Rgba;
  /** When present it is painted instead of `fill` (which is kept so switching back restores the colour). */
  readonly gradient?: Gradient;
  readonly stroke?: {
    readonly color: Rgba;
    readonly width: number;
    readonly join?: "miter" | "round" | "bevel";
    readonly cap?: "butt" | "round" | "square";
  };
}

/** Reference to an imported picture. The bytes live in the asset store under `asset`. */
export interface ImageContent {
  /** Content hash (lowercase hex). */
  readonly asset: string;
  /** Size of the decoded picture in pixels, which is also its size in composition units at scale 1. */
  readonly width: number;
  readonly height: number;
}

/** Reference to an imported video clip. The file lives in the asset store under `asset`. */
export interface VideoContent {
  /** Content fingerprint (lowercase hex). */
  readonly asset: string;
  /** Frame size as coded in the file, before rotation. */
  readonly codedWidth: number;
  readonly codedHeight: number;
  /** Clockwise degrees the file asks players to rotate frames by (phones store portrait clips sideways). */
  readonly rotation: 0 | 90 | 180 | 270;
  /** Clip length in seconds. */
  readonly duration: number;
  /** Composition time, in seconds, at which the clip's first frame plays. In and out points only gate visibility. */
  readonly start: number;
}

export type TextUnit = "char" | "word" | "line";

/** Each unit (character, word or line) starts in the "from" state and settles to rest, staggered in time. */
export interface TextAnimator {
  readonly unit: TextUnit;
  /** Seconds before the first unit starts. */
  readonly start: number;
  /** Seconds between one unit's start and the next. Negative runs the units back to front. */
  readonly stagger: number;
  /** Seconds each unit takes to settle. */
  readonly duration: number;
  readonly ease: Bezier;
  readonly from: {
    readonly opacity: number;
    readonly dx: number;
    readonly dy: number;
    /** Multiplier, 1 = unchanged. */
    readonly scale: number;
    /** Degrees. */
    readonly rotation: number;
  };
}

/** A text layer's words. Its outlines are stored in `shape.path`, kept in step by the editor. */
export interface TextContent {
  readonly text: string;
  readonly size: number;
  /** Extra space between characters, in text units. */
  readonly tracking: number;
  readonly align: "left" | "center" | "right";
  readonly animator?: TextAnimator;
}

export interface Layer {
  readonly id: Id;
  readonly name: string;
  readonly kind: "shape" | "image" | "video";
  readonly parent?: Id;
  /** Defaults to "normal". */
  readonly blend?: BlendMode;
  /** Not drawn (it can still serve as a track matte). */
  readonly hidden?: boolean;
  readonly masks?: readonly Mask[];
  readonly matte?: Matte;
  /** Applied in order to the layer as a whole (all its fill, stroke and picture), before blending. */
  readonly effects?: readonly Effect[];
  readonly transform: Transform;
  /** Present on shape layers. */
  readonly shape?: ShapeContent;
  /** Present on text layers (which are shape layers whose outline comes from the text). */
  readonly text?: TextContent;
  /** Present on image layers. */
  readonly image?: ImageContent;
  /** Present on video layers. */
  readonly video?: VideoContent;
  /** Seconds. The layer is visible for inPoint <= t < outPoint. Defaults: 0 and the composition duration. */
  readonly inPoint?: number;
  readonly outPoint?: number;
}

export interface Composition {
  /** Project name shown in the project list. */
  readonly name?: string;
  /** Straight RGBA 0..1 behind all layers. Defaults to white. */
  readonly background?: Rgba;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly layers: readonly Layer[];
}
