import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";

/** The part of a decoded sample this code needs (Mediabunny's VideoSample satisfies it). */
export interface Sample {
  readonly timestamp: number;
  readonly duration: number;
  toVideoFrame(): VideoFrame;
  close(): void;
}

/** What a decoder offers: random access and sequential iteration (Mediabunny's VideoSampleSink satisfies it). */
export interface SampleSource {
  getSample(t: number): Promise<Sample | null>;
  samples(start: number): AsyncGenerator<Sample, void, unknown>;
}

export interface ClipInfo {
  codedWidth: number;
  codedHeight: number;
  rotation: 0 | 90 | 180 | 270;
  duration: number;
  codec: string | null;
}

/** Forward jumps shorter than this are decoded straight through; longer ones seek (a keyframe may be closer). */
const SEQUENTIAL_WINDOW_S = 1.5;

/**
 * Frame-accurate access to one clip. Moving forward (playback) decodes
 * sequentially, which runs at several hundred frames per second; jumping or
 * scrubbing backwards seeks. Calls are serialised, so it is safe to call from
 * several places, though only one position is tracked at a time: use one
 * reader per consumer (editor preview, export).
 */
export class ClipReader {
  private cur: Sample | null = null;
  private next: Sample | null = null;
  private iter: AsyncGenerator<Sample, void, unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly source: SampleSource,
    readonly info: ClipInfo,
    private readonly onClose: () => void = () => {},
  ) {}

  /** Open a clip from bytes. Rejects with a readable message when the file or codec is unsupported. */
  static async open(blob: Blob): Promise<ClipReader> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("This file has no video track.");
      if (!(await track.canDecode())) {
        const codec = await track.getCodecParameterString().catch(() => null);
        throw new Error(`This device cannot decode this video${codec ? ` (${codec})` : ""}. Try exporting it from Photos as "Most Compatible".`);
      }
      const duration = await track.computeDuration();
      const info: ClipInfo = {
        codedWidth: await track.getCodedWidth(),
        codedHeight: await track.getCodedHeight(),
        rotation: track.rotation as ClipInfo["rotation"],
        duration,
        codec: await track.getCodecParameterString().catch(() => null),
      };
      const sink = new VideoSampleSink(track);
      return new ClipReader(sink as unknown as SampleSource, info, () => input.dispose());
    } catch (e) {
      input.dispose();
      throw e;
    }
  }

  /**
   * A new VideoFrame (owned by the caller, who must close it) showing the clip at
   * `t` seconds. Times before the first frame give the first frame; after the end,
   * the last frame. Null only for an empty clip.
   */
  frameAt(t: number): Promise<VideoFrame | null> {
    const run = this.chain.then(async () => {
      const sample = await this.sampleAt(Math.min(Math.max(t, 0), this.info.duration));
      return sample ? sample.toVideoFrame() : null;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  private async sampleAt(t: number): Promise<Sample | null> {
    const cur = this.cur;
    if (cur && t >= cur.timestamp && t < cur.timestamp + cur.duration) return cur; // still the same frame
    if (cur && this.iter && t > cur.timestamp && t - cur.timestamp < SEQUENTIAL_WINDOW_S) {
      for (;;) {
        if (!this.next) {
          const r = await this.iter.next();
          if (r.done) break; // end of clip: hold the last frame
          this.next = r.value;
        }
        if (this.next.timestamp > t) break;
        this.cur!.close();
        this.cur = this.next;
        this.next = null;
      }
      return this.cur;
    }
    return this.seek(t);
  }

  private async seek(t: number): Promise<Sample | null> {
    await this.iter?.return();
    this.iter = null;
    this.cur?.close();
    this.next?.close();
    this.cur = this.next = null;
    const first = (await this.source.getSample(t)) ?? (await this.source.getSample(0));
    if (!first) return null;
    this.cur = first;
    // Continue from just after this frame. The iterator's first sample may repeat the one we hold; drop it.
    this.iter = this.source.samples(first.timestamp);
    const r = await this.iter.next();
    if (!r.done) {
      if (r.value.timestamp <= first.timestamp + 1e-6) r.value.close();
      else this.next = r.value;
    }
    return this.cur;
  }

  async close(): Promise<void> {
    await this.chain.catch(() => {});
    await this.iter?.return();
    this.cur?.close();
    this.next?.close();
    this.cur = this.next = this.iter = null;
    this.onClose();
  }
}
