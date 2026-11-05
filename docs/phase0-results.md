# Phase 0 results

Risk spikes from the MVP plan. "iPad" means the M1 iPad Air (2022) in a
WebKit-based browser. Safari hides memory figures, which is why the export
result shows `deviceMemoryGB: null`. "Container" means headless Chromium with a
software GPU: it can check logic and correctness, not speed or real-GPU behaviour.

| Spike | Where | Result |
|---|---|---|
| Vector tessellation | iPad | Renders correctly: ring with hole, island, round caps and joins, mitered star, bevels. 767 triangles, 1,243 vertices, 5.00 ms one-shot (coarse timer, cold run). Pixel-level edge quality not assessed. |
| MP4 export | iPad | 1080p60, 10 s, 12 Mbps, GPU readback: 600 frames in 3.85 s = **156 fps average (2.6x real time)**. Per-second frames: 92, 176, 180, 152 (last is a partial second). Encoder backpressure 0, max queue 2. 7.9 MB output (about 6.3 Mbps, simple scene). Canvas-to-VideoFrame also works but is slower. |
| MP4 export | Container | Valid H.264 High 4.2 at 1080p60 (ffprobe). Canvas mode gave black frames here; readback correct. Environment limit. |
| Video into WebGPU | Container | Decode and frame-accurate seeking verified (24 random seeks, 0 wrong frames, mean 55 ms, p95 68 ms). CPU upload and ImageBitmap upload verified. `copyExternalImageToTexture` from a VideoFrame and `importExternalTexture` destroy the device in this environment. 6 simultaneous decoders succeeded (decode only). |
| Video into WebGPU | iPad | **Not yet run.** Open `/video.html`. |
| Pencil and touch | iPad | Not started. |

## What this means for the plan

- Export is a low risk: large headroom at 1080p60 on a simple scene. Open: thermal behaviour over 30 s or more, and heavier scenes.
- Use GPU readback as the primary export frame source; keep canvas-to-VideoFrame as a fallback.
- Video layers are feasible in principle (decode and seeking work), but the GPU upload path on Safari is **unknown** until the iPad run. The CPU path (`frame.copyTo` + `writeTexture`) is the guaranteed fallback and costs about 28 ms per 1080p frame in the container, so it is not a viable path for real-time multi-layer playback.

## Findings worth keeping

- WGSL reserves `target` as a keyword; a struct field with that name makes the pipeline invalid.
- WebGPU `popErrorScope()` rejects with "Instance dropped" when the device has been destroyed. Catch it separately so it never hides the original error.
- Keep a reference to the GPU adapter for the renderer's lifetime. Chromium's readback failed while a canvas render loop was running; cause not found.
- `mp4-muxer` is deprecated; Mediabunny is used for demuxing/decoding here and should replace it for muxing.

## Open questions

1. Which upload paths work on iPad Safari, and how fast (`/video.html`).
2. Throttling on a 30 s or longer export, and on a heavier scene.
3. How many simultaneous video decoders iPadOS allows.
4. Pencil: what pointer data Safari really delivers (pressure, tilt, palm rejection).
