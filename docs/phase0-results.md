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
| Video into WebGPU | iPad | Run on the exported 1080p60 H.264 clip (not the coded test clip, so picture correctness and seek accuracy were **not** verified: see below). Decode: 600 frames in 806 ms = **744 fps**. Upload paths, 1080p, per frame including GPU wait: `importExternalTexture` **0.82 ms** (682 fps sequential), `copyExternalImageToTexture` 6.8 ms (143 fps), `ImageBitmap` 17 ms (58 fps). **All three GPU paths ran without error.** The CPU path failed: Safari's `VideoFrame.copyTo` ignored the RGBA request (buffer was 3,110,400 bytes = 1920x1080x1.5, a native YUV 4:2:0 size). 1, 2, 4 and 6 simultaneous decoders all worked at about 650 fps combined (decode only). |
| Pencil and touch | iPad | Not started. |

## What this means for the plan

- Export is a low risk: large headroom at 1080p60 on a simple scene. Open: thermal behaviour over 30 s or more, and heavier scenes.
- Use GPU readback as the primary export frame source; keep canvas-to-VideoFrame as a fallback.
- Video layers look feasible: on the iPad `importExternalTexture` takes under 1 ms per 1080p frame and decode runs at about 12x real time for 1080p60. Use `importExternalTexture` as the primary path; `copyExternalImageToTexture` is a reasonable fallback (about 7 ms).
- Not yet shown on the iPad: that the pictures are correct (the first run's check could not tell a white frame from the clear colour; fixed), frame-accurate seeking, and seek latency. Re-run `/video.html` **without picking a file** to use the coded clip.
- The CPU path is not available on Safari (no format conversion in `copyTo`). A YUV-to-RGB shader would be needed if a CPU fallback is ever required.
- Decode limits were not reached at 6 concurrent 1080p60 streams, but that was one H.264 clip, decode only. HEVC, 4K and mixed content are untested.

## Findings worth keeping

- WGSL reserves `target` as a keyword; a struct field with that name makes the pipeline invalid.
- WebGPU `popErrorScope()` rejects with "Instance dropped" when the device has been destroyed. Catch it separately so it never hides the original error.
- Keep a reference to the GPU adapter for the renderer's lifetime. Chromium's readback failed while a canvas render loop was running; cause not found.
- Safari's `VideoFrame.copyTo` / `allocationSize` do not honour a `format` option; they use the native layout.
- A readback check against a magenta clear colour cannot tell a white or magenta picture from "nothing drawn". Check for non-clear pixels, or use a coded clip.
- `mp4-muxer` is deprecated; Mediabunny is used for demuxing/decoding here and should replace it for muxing.

## Open questions

1. iPad: correct picture and frame-accurate seeking with the coded clip, and seek latency (`/video.html`, no file picked). HEVC and 4K phone clips.
2. Throttling on a 30 s or longer export, and on a heavier scene.
3. How many simultaneous video decoders iPadOS allows.
4. Pencil: what pointer data Safari really delivers (pressure, tilt, palm rejection).
