import { ALL_FORMATS, BlobSource, Input, UrlSource, VideoSampleSink, type InputVideoTrack } from "mediabunny";
import { VideoQuadRenderer, type UploadMode } from "../render/videoQuad";

declare global {
  interface Window {
    __video?: { done: boolean; result?: unknown; error?: string };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const CLIP = params.get("clip") ?? "clips/coded-1080p30.mp4";
const FPS = Number(params.get("fps") ?? 30);
const TARGET_W = 960;
const TARGET_H = 540;
const BITS = 16;
const SQ = 48; // square size in the 960x540 render (96 px in the source)

const MODES: UploadMode[] = ["cpu", "copy", "bitmap", "external"];
const status = (s: string) => ($("status").textContent = s);
const now = () => performance.now();

function stats(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { n: s.length, mean: round(s.reduce((a, b) => a + b, 0) / s.length), median: round(q(0.5)), p95: round(q(0.95)), max: round(s[s.length - 1]!) };
}
const round = (n: number) => Math.round(n * 100) / 100;

/** Decode the frame index drawn in the top row of squares. */
async function readIndex(r: VideoQuadRenderer): Promise<number> {
  const row = await r.readRow(SQ / 2);
  let v = 0;
  for (let b = 0; b < BITS; b++) {
    const x = b * SQ + SQ / 2;
    v = (v << 1) | (row[x * 4]! > 127 ? 1 : 0);
  }
  return v;
}

/** True if the middle row of the render contains pixels other than the magenta clear colour. */
async function drewContent(r: VideoQuadRenderer): Promise<boolean> {
  const row = await r.readRow(Math.floor(TARGET_H / 2));
  let other = 0;
  for (let x = 0; x < TARGET_W; x++) {
    const R = row[x * 4]!;
    const G = row[x * 4 + 1]!;
    const B = row[x * 4 + 2]!;
    if (!(R > 200 && G < 60 && B > 200)) other++;
  }
  return other > TARGET_W * 0.02;
}

async function openClip(file: File | null) {
  const input = new Input({
    source: file ? new BlobSource(file) : new UrlSource(new URL(CLIP, location.href)),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track");
  return { input, track };
}

function seededIndices(n: number, max: number): number[] {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, () => Math.floor(rnd() * max));
}

async function run() {
  const out = $("out");
  window.__video = { done: false };
  const result: Record<string, unknown> = {};
  try {
    const file = $<HTMLInputElement>("file").files?.[0] ?? null;
    status("Opening clip…");
    const { input, track } = await openClip(file);
    const decoderConfig = await track.getDecoderConfig();
    result.clip = {
      source: file ? file.name : CLIP,
      codec: decoderConfig?.codec,
      coded: `${track.codedWidth}x${track.codedHeight}`,
      canDecode: await track.canDecode(),
      duration: round(await input.computeDuration()),
      webCodecs: typeof VideoDecoder !== "undefined",
    };
    if (!(result.clip as { canDecode: boolean }).canDecode) throw new Error("This browser cannot decode the clip's codec");

    // One GPU device per upload mode, so a mode that destroys its device cannot break the others.
    const renderers = new Map<UploadMode, VideoQuadRenderer>();
    const rendererFor = async (mode: UploadMode) => {
      let r = renderers.get(mode);
      if (!r || r.lostReason) {
        r?.destroy();
        r = await VideoQuadRenderer.create(TARGET_W, TARGET_H);
        renderers.set(mode, r);
      }
      return r;
    };
    const sink = new VideoSampleSink(track);

    // Probe every upload mode on one frame. For our coded test clip the frame index must read back
    // exactly. For any other clip we can only check that something other than the clear colour was drawn.
    const probe: Record<string, { idx?: number; drew?: boolean; error?: string }> = {};
    for (const mode of MODES) {
      status(`Probing upload mode: ${mode}…`);
      try {
        const s = await sink.getSample(31.5 / FPS);
        if (!s) throw new Error("no sample");
        const f = s.toVideoFrame();
        const renderer = await rendererFor(mode);
        try {
          if (!result.frameFormat) {
            result.frameFormat = {
              format: f.format,
              display: `${f.displayWidth}x${f.displayHeight}`,
              colorSpace: JSON.stringify(f.colorSpace),
              copyToRgbaBytes: (() => {
                try {
                  return f.allocationSize({ format: "RGBA" });
                } catch (e) {
                  return `throws: ${e instanceof Error ? e.message : String(e)}`;
                }
              })(),
              rgbaBytesExpected: f.displayWidth * f.displayHeight * 4,
            };
          }
          await renderer.draw(f, mode);
          await renderer.idle();
          probe[mode] = { idx: await readIndex(renderer), drew: await drewContent(renderer) };
        } finally {
          f.close();
          s.close();
        }
      } catch (e) {
        const lost = renderers.get(mode)?.lostReason;
        probe[mode] = { error: `${e instanceof Error ? e.message : String(e)}${lost ? ` [device ${lost}]` : ""}` };
      }
    }
    const coded = Object.values(probe).some((p) => p.idx === 31);
    const support: Record<string, string> = {};
    let workingMode: UploadMode | null = null;
    for (const mode of MODES) {
      const p = probe[mode]!;
      let ok = false;
      if (p.error) support[mode] = `FAILED: ${p.error}`;
      else if (coded) {
        ok = p.idx === 31;
        support[mode] = ok ? "ok (frame index verified)" : `WRONG: read index ${p.idx}, expected 31`;
      } else {
        ok = !!p.drew;
        support[mode] = ok
          ? "ok (picture drawn; frame index not checked because this is not the coded test clip)"
          : "NOTHING DRAWN: only the clear colour came back";
      }
      if (ok && !workingMode) workingMode = mode;
    }
    result.support = support;
    result.codedClip = coded;
    if (!workingMode) throw new Error("No upload mode produced a usable picture; see support");

    // Sequential decode only (no GPU): how fast can frames be produced?
    status("Decode throughput…");
    {
      const t0 = now();
      let n = 0;
      for await (const s of sink.samples()) {
        n++;
        s.close();
      }
      const ms = now() - t0;
      result.decodeOnly = { frames: n, ms: round(ms), fps: round(n / (ms / 1000)) };
    }

    // Sequential decode + upload + draw per mode.
    result.sequential = {} as Record<string, unknown>;
    for (const mode of MODES) {
      if (!support[mode]?.startsWith("ok")) continue;
      status(`Sequential: ${mode}…`);
      const renderer = await rendererFor(mode);
      const uploadMs: number[] = [];
      let n = 0;
      let mismatches = 0;
      let checked = 0;
      const t0 = now();
      for await (const s of sink.samples(0, 3)) {
        const f = s.toVideoFrame();
        const u0 = now();
        await renderer.draw(f, mode);
        await renderer.idle();
        uploadMs.push(now() - u0);
        if (coded && n % 10 === 0) {
          checked++;
          if ((await readIndex(renderer)) !== n) mismatches++;
        }
        f.close();
        s.close();
        n++;
      }
      const ms = now() - t0;
      (result.sequential as Record<string, unknown>)[mode] = {
        frames: n,
        totalFps: round(n / (ms / 1000)),
        uploadDrawMs: stats(uploadMs),
        indexChecks: coded ? { checked, mismatches } : "n/a",
      };
    }

    // Random seeks with the fastest mode that verified.
    const seqStats = result.sequential as Record<string, { uploadDrawMs: { mean: number } | null }>;
    for (const m of MODES) {
      const mean = seqStats[m]?.uploadDrawMs?.mean;
      const best = workingMode ? seqStats[workingMode]?.uploadDrawMs?.mean : undefined;
      if (support[m]?.startsWith("ok") && mean !== undefined && (best === undefined || mean < best)) workingMode = m;
    }
    if (workingMode) {
      const renderer = await rendererFor(workingMode);
      status("Random seeks…");
      const totalFrames = Math.floor((result.clip as { duration: number }).duration * FPS);
      const targets = seededIndices(24, totalFrames);
      const lat: number[] = [];
      const wrong: Array<{ want: number; got: number }> = [];
      for (const i of targets) {
        const t0 = now();
        const s = await sink.getSample((i + 0.5) / FPS);
        if (!s) {
          wrong.push({ want: i, got: -1 });
          continue;
        }
        const f = s.toVideoFrame();
        await renderer.draw(f, workingMode);
        await renderer.idle();
        const got = coded ? await readIndex(renderer) : i;
        lat.push(now() - t0);
        if (got !== i) wrong.push({ want: i, got });
        f.close();
        s.close();
      }
      result.seek = {
        mode: workingMode,
        seeks: targets.length,
        latencyMs: stats(lat),
        frameAccuracy: coded ? (wrong.length === 0 ? "verified: every seek returned the requested frame" : "FAILED") : "not checked (not the coded test clip)",
        wrong: coded ? wrong : "n/a",
      };
    }

    // Several decoders at once.
    status("Concurrent decoders…");
    const conc: unknown[] = [];
    for (const count of [1, 2, 4, 6]) {
      const inputs: Input[] = [];
      try {
        const sinks: VideoSampleSink[] = [];
        for (let k = 0; k < count; k++) {
          const c = await openClip(file);
          inputs.push(c.input);
          sinks.push(new VideoSampleSink(c.track));
        }
        const iters = sinks.map((sk) => sk.samples(0, 2)[Symbol.asyncIterator]());
        const t0 = now();
        let frames = 0;
        let alive = true;
        while (alive) {
          alive = false;
          for (const it of iters) {
            const r = await it.next();
            if (!r.done) {
              r.value.close();
              frames++;
              alive = true;
            }
          }
        }
        const ms = now() - t0;
        conc.push({ decoders: count, frames, aggregateFps: round(frames / (ms / 1000)), perStreamFps: round(frames / count / (ms / 1000)) });
      } catch (e) {
        conc.push({ decoders: count, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
      } finally {
        for (const i of inputs) i.dispose();
      }
    }
    result.concurrent = conc;

    input.dispose();
    for (const r of renderers.values()) r.destroy();
    status("Done");
    window.__video = { done: true, result };
    out.textContent = JSON.stringify(result, null, 1);
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    result.error = error;
    window.__video = { done: true, error, result };
    status("Error");
    out.textContent = JSON.stringify(result, null, 1) + `\nError: ${error}`;
  }
}

const btn = $<HTMLButtonElement>("run");
btn.addEventListener("click", async () => {
  btn.disabled = true;
  await run();
  btn.disabled = false;
});
if (params.has("auto")) void run();
