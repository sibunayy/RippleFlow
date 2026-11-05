import { scale } from "../core/affine";
import { evaluateScene } from "../core/scene";
import type { Composition, Id, VideoContent } from "../core/types";
import type { FrameRef } from "../video/videoLibrary";
import { buildLayerGeometry, type ShapeGeometry } from "../geometry/layerGeometry";
import { MeshRenderer } from "../render/meshRenderer";
import { backgroundDraw, DEFAULT_BACKGROUND, drawsFor, SceneSync } from "../app/sceneDraws";
import { exportMp4, type ExportResult } from "./encodeMp4";

export interface ExportPreset {
  readonly id: string;
  readonly label: string;
  readonly height: number;
  readonly fps: number;
  /** Bits per second. */
  readonly bitrate: number;
}

/** 1080p60 at 12 Mbps was measured at 156 fps encode on the target iPad (docs/phase0-results.md). */
export const PRESETS: readonly ExportPreset[] = [
  { id: "720p30", label: "720p · 30 fps", height: 720, fps: 30, bitrate: 5_000_000 },
  { id: "1080p30", label: "1080p · 30 fps", height: 1080, fps: 30, bitrate: 8_000_000 },
  { id: "1080p60", label: "1080p · 60 fps", height: 1080, fps: 60, bitrate: 12_000_000 },
];

/** What the pixels we hand the encoder are: BT.709 primaries, transfer and matrix, limited (16..235) range. */
export const BT709_LIMITED: VideoColorSpaceInit = { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2); // H.264 4:2:0 needs even dimensions

/** Output pixel size for a preset, keeping the composition's aspect ratio. */
export function exportSize(comp: Composition, preset: ExportPreset): { width: number; height: number } {
  return { width: even((preset.height * comp.width) / comp.height), height: even(preset.height) };
}

export interface ExportOptions {
  readonly preset: ExportPreset;
  readonly signal?: AbortSignal;
  /** Resolves a loaded picture by asset id (image layers). */
  readonly bitmapOf?: (asset: string) => ImageBitmap | undefined;
  /** Source of video frames (one export session). Required when the composition has video layers. */
  readonly videos?: { frame(video: VideoContent, t: number): Promise<FrameRef | undefined> };
  readonly onProgress?: (done: number, total: number) => void;
}

/**
 * Render the composition frame by frame on a dedicated offscreen renderer and
 * encode it to MP4. Uses the same evaluateScene and draw building as the
 * editor, so what you see is what is exported. Always releases GPU resources.
 */
export async function exportComposition(comp: Composition, opts: ExportOptions): Promise<ExportResult> {
  const { width, height } = exportSize(comp, opts.preset);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = await MeshRenderer.create(canvas);
  const readback = renderer.createNv12Readback();
  try {
    const bg = comp.background ?? DEFAULT_BACKGROUND;
    renderer.clearColor = { r: bg[0], g: bg[1], b: bg[2], a: 1 };

    const geometry = new Map<Id, ShapeGeometry | undefined>();
    for (const l of comp.layers) geometry.set(l.id, buildLayerGeometry(l, opts.bitmapOf ?? (() => undefined)));
    const videoOf = new Map(comp.layers.filter((l) => l.video).map((l) => [l.id, l.video!]));
    const toDevice = scale(width / comp.width, height / comp.height);
    const sync = new SceneSync();

    return await exportMp4(
      {
        width,
        height,
        fps: opts.preset.fps,
        durationSec: comp.duration,
        bitrate: opts.preset.bitrate,
        keyframeEverySec: 1, // short GOPs keep the file quick to scrub in other apps
        colorSpace: BT709_LIMITED,
        signal: opts.signal,
      },
      async (index, timestamp, duration) => {
        const t = index / opts.preset.fps;
        const items = evaluateScene(comp, t);
        // Decode this instant's frame of every visible video layer before drawing.
        const media = new Map<Id, FrameRef>();
        for (const item of items) {
          const v = videoOf.get(item.id);
          if (!v) continue;
          const ref = await opts.videos?.frame(v, t);
          if (ref) media.set(item.id, ref);
        }
        const draws = [backgroundDraw(comp, toDevice), ...drawsFor(items, (id) => geometry.get(id), toDevice, (id) => media.get(id))];
        sync.sync(renderer, draws);
        const data = await readback.read();
        return new VideoFrame(data, {
          format: "NV12",
          codedWidth: width,
          codedHeight: height,
          timestamp,
          duration,
          colorSpace: BT709_LIMITED,
          layout: [
            { offset: 0, stride: readback.stride },
            { offset: readback.stride * height, stride: readback.stride },
          ],
        });
      },
      opts.onProgress,
    );
  } finally {
    readback.destroy();
    renderer.destroy();
  }
}

