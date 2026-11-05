import type { VideoContent } from "../core/types";
import { hashBlobSampled, type AssetStore } from "../persist/assets";
import { ClipReader } from "./clipReader";

/** A frame ready to draw. `frame` is for external-texture sampling, `image` for the bitmap fallback. */
export interface FrameRef {
  frame?: VideoFrame;
  image?: ImageBitmap;
}

/** "external": import the VideoFrame directly (fast, the iPad path). "bitmap": convert to ImageBitmap first (slow; for browsers or test environments without external textures). */
export type VideoMode = "external" | "bitmap";

const closeRef = (r: FrameRef) => {
  r.frame?.close();
  r.image?.close();
};

async function makeRef(frame: VideoFrame, mode: VideoMode): Promise<FrameRef> {
  if (mode === "external") return { frame };
  try {
    return { image: await createImageBitmap(frame) };
  } finally {
    frame.close();
  }
}

/** Seconds a frame is valid for: its own start up to the next frame (default 1/30 s when the file gives no duration). */
const spanOf = (f: VideoFrame): [number, number] => {
  const t0 = f.timestamp / 1e6;
  return [t0, t0 + (f.duration && f.duration > 0 ? f.duration / 1e6 : 1 / 30)];
};

interface ClipState {
  reader: Promise<ClipReader>;
  ready?: ClipReader;
  failed?: unknown;
  wanted: number | null;
  busy: boolean;
  shown?: { t0: number; t1: number; ref: FrameRef };
  retired: FrameRef[];
}

/** Retired frames are closed this many frames late, so a draw that still holds one never sees it closed. */
const KEEP_RETIRED = 3;

/**
 * Decoded video for the editor preview. `frameOf` is synchronous (the render
 * path): it returns the frame it has and, when the playhead needs a different
 * one, starts decoding it in the background and calls `onChange` when it lands.
 * Only the newest request is decoded, so scrubbing never queues up stale work.
 */
export class VideoLibrary {
  private clips = new Map<string, ClipState>();

  constructor(
    private readonly assets: AssetStore,
    private readonly onChange: () => void,
    readonly mode: VideoMode = "external",
    private readonly open: (blob: Blob) => Promise<ClipReader> = (b) => ClipReader.open(b),
  ) {}

  /** Import a clip: check it can be decoded, store the original file, return its layer content (placed at `start`). */
  async import(file: Blob, start: number): Promise<VideoContent> {
    const reader = await this.open(file); // rejects with a readable message if unsupported
    const { info } = reader;
    await reader.close();
    const asset = await hashBlobSampled(file);
    if (!(await this.assets.has(asset))) await this.assets.put(asset, file);
    return { asset, codedWidth: info.codedWidth, codedHeight: info.codedHeight, rotation: info.rotation, duration: info.duration, start };
  }

  /** The frame to show for composition time `t`, or undefined until the first one has decoded. */
  frameOf(video: VideoContent, t: number): FrameRef | undefined {
    const s = this.state(video.asset);
    const src = Math.min(Math.max(t - video.start, 0), video.duration);
    if (s.shown && src >= s.shown.t0 && src < s.shown.t1) return s.shown.ref;
    s.wanted = src;
    void this.pump(s);
    return s.shown?.ref;
  }

  /** Asset ids that could not be opened (missing from storage, or undecodable here). */
  failed(): string[] {
    return [...this.clips].filter(([, s]) => s.failed !== undefined).map(([id]) => id);
  }

  /** A separate sequential reader for rendering an export, so exporting never disturbs the preview. */
  exportSession(): ExportSession {
    return new ExportSession(this.assets, this.mode, this.open);
  }

  private state(asset: string): ClipState {
    let s = this.clips.get(asset);
    if (!s) {
      const created: ClipState = {
        wanted: null,
        busy: false,
        retired: [],
        reader: this.assets.get(asset).then((blob) => {
          if (!blob) throw new Error(`Video ${asset} is missing from storage`);
          return this.open(blob);
        }),
      };
      created.reader.then(
        (r) => {
          created.ready = r;
          void this.pump(created);
        },
        (e) => {
          created.failed = e;
          this.onChange();
        },
      );
      this.clips.set(asset, created);
      s = created;
    }
    return s;
  }

  private async pump(s: ClipState): Promise<void> {
    if (s.busy || !s.ready) return;
    s.busy = true;
    try {
      while (s.wanted !== null) {
        const t = s.wanted;
        s.wanted = null;
        const frame = await s.ready.frameAt(t);
        if (!frame) break;
        const [t0, t1] = spanOf(frame);
        const ref = await makeRef(frame, this.mode);
        if (s.shown) {
          s.retired.push(s.shown.ref);
          while (s.retired.length > KEEP_RETIRED) closeRef(s.retired.shift()!);
        }
        s.shown = { t0, t1, ref };
        this.onChange();
      }
    } catch (e) {
      s.failed = e;
      this.onChange();
    } finally {
      s.busy = false;
    }
  }
}

/** One pass over the clips during an export: frames come in time order, one reader per clip. */
export class ExportSession {
  private readers = new Map<string, Promise<ClipReader>>();
  private held = new Map<string, FrameRef>();

  constructor(
    private readonly assets: AssetStore,
    private readonly mode: VideoMode,
    private readonly open: (blob: Blob) => Promise<ClipReader>,
  ) {}

  /** The frame for composition time `t`. It stays valid until the next call for the same clip, or `close()`. */
  async frame(video: VideoContent, t: number): Promise<FrameRef | undefined> {
    let reader = this.readers.get(video.asset);
    if (!reader) {
      reader = this.assets.get(video.asset).then((blob) => {
        if (!blob) throw new Error(`Video ${video.asset} is missing from storage`);
        return this.open(blob);
      });
      this.readers.set(video.asset, reader);
    }
    const frame = await (await reader).frameAt(Math.min(Math.max(t - video.start, 0), video.duration));
    if (!frame) return undefined;
    const ref = await makeRef(frame, this.mode);
    const old = this.held.get(video.asset);
    if (old) closeRef(old);
    this.held.set(video.asset, ref);
    return ref;
  }

  async close(): Promise<void> {
    for (const r of this.held.values()) closeRef(r);
    this.held.clear();
    for (const p of this.readers.values()) await p.then((r) => r.close(), () => {});
    this.readers.clear();
  }
}
