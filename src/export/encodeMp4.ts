import { ArrayBufferTarget, Muxer } from "mp4-muxer";

export interface ExportConfig {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  /** Bits per second. */
  bitrate: number;
  keyframeEverySec?: number;
  /** Max frames queued inside the encoder before we wait. */
  maxQueue?: number;
}

/** Produces the frame for `index`. The exporter closes the returned frame. */
export type FrameSource = (index: number, timestampUs: number, durationUs: number) => Promise<VideoFrame>;

export interface ExportResult {
  blob: Blob;
  codec: string;
  frames: number;
  bytes: number;
  wallMs: number;
  avgFps: number;
  /** Frames completed in each wall-clock second. A downward trend suggests throttling. */
  fpsPerSecond: number[];
  frameSourceMs: number;
  backpressureMs: number;
  maxQueueSeen: number;
}

// [level_idc, MaxMBPS, MaxFS] from the H.264 spec, Table A-1.
const LEVELS: ReadonlyArray<readonly [number, number, number]> = [
  [0x1e, 40500, 1620],
  [0x1f, 108000, 3600],
  [0x20, 216000, 5120],
  [0x28, 245760, 8192],
  [0x2a, 522240, 8704],
  [0x32, 589824, 22080],
  [0x33, 983040, 36864],
  [0x34, 2073600, 36864],
];

const hex = (n: number) => n.toString(16).padStart(2, "0");

/** Lowest AVC level that fits the frame size and rate. */
export function avcLevel(width: number, height: number, fps: number): number {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  for (const [idc, maxMbps, maxFs] of LEVELS) {
    if (mbs <= maxFs && mbs * fps <= maxMbps) return idc;
  }
  return 0x34;
}

/** First H.264 profile/level string the browser says it can encode, or null. */
export async function pickCodec(cfg: ExportConfig): Promise<string | null> {
  const level = hex(avcLevel(cfg.width, cfg.height, cfg.fps));
  for (const profile of ["6400", "4d00", "4200"]) {
    const codec = `avc1.${profile}${level}`;
    const r = await VideoEncoder.isConfigSupported({
      codec,
      width: cfg.width,
      height: cfg.height,
      bitrate: cfg.bitrate,
      framerate: cfg.fps,
      avc: { format: "avc" },
    });
    if (r.supported) return codec;
  }
  return null;
}

export async function exportMp4(
  cfg: ExportConfig,
  source: FrameSource,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  if (typeof VideoEncoder === "undefined") throw new Error("WebCodecs VideoEncoder is not available");
  const codec = await pickCodec(cfg);
  if (!codec) throw new Error("No supported H.264 configuration for this size/fps/bitrate");

  const total = Math.round(cfg.fps * cfg.durationSec);
  const frameUs = 1_000_000 / cfg.fps;
  const keyEvery = Math.max(1, Math.round((cfg.keyframeEverySec ?? 2) * cfg.fps));
  const maxQueue = cfg.maxQueue ?? 4;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: cfg.width, height: cfg.height, frameRate: cfg.fps },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e;
    },
  });
  encoder.configure({
    codec,
    width: cfg.width,
    height: cfg.height,
    bitrate: cfg.bitrate,
    framerate: cfg.fps,
    avc: { format: "avc" },
  });

  const start = performance.now();
  const perSecond: number[] = [];
  let frameSourceMs = 0;
  let backpressureMs = 0;
  let maxQueueSeen = 0;

  for (let i = 0; i < total; i++) {
    if (encodeError) throw encodeError;

    const w0 = performance.now();
    while (encoder.encodeQueueSize > maxQueue) {
      await new Promise<void>((r) => encoder.addEventListener("dequeue", () => r(), { once: true }));
      if (encodeError) throw encodeError;
    }
    backpressureMs += performance.now() - w0;

    const f0 = performance.now();
    const ts = Math.round(i * frameUs);
    const frame = await source(i, ts, Math.round(frameUs));
    frameSourceMs += performance.now() - f0;

    encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    maxQueueSeen = Math.max(maxQueueSeen, encoder.encodeQueueSize);

    const sec = Math.floor((performance.now() - start) / 1000);
    perSecond[sec] = (perSecond[sec] ?? 0) + 1;
    onProgress?.(i + 1, total);
  }

  await encoder.flush();
  if (encodeError) throw encodeError;
  encoder.close();
  muxer.finalize();
  const wallMs = performance.now() - start;
  const blob = new Blob([target.buffer], { type: "video/mp4" });

  return {
    blob,
    codec,
    frames: total,
    bytes: blob.size,
    wallMs,
    avgFps: total / (wallMs / 1000),
    fpsPerSecond: Array.from(perSecond, (n) => n ?? 0),
    frameSourceMs,
    backpressureMs,
    maxQueueSeen,
  };
}
