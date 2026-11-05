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
| Video into WebGPU | iPad, Safari 27.2, coded test clip | **Picture correct and seeking frame-accurate.** All three GPU paths showed the right frame index (9 spot checks each, 0 mismatches). Native frame format **NV12**; the CPU path cannot convert to RGBA here (as before). Sequential 1080p upload+draw: `importExternalTexture` **0.83 ms** (616 fps), `copyExternalImageToTexture` 6.7 ms (141 fps), `ImageBitmap` 16.8 ms (59 fps). Decode alone 720 fps. **Seek (external path): 24 random seeks, all returned the requested frame, median 34 ms, p95 51 ms, max 52 ms.** 1/2/4/6 simultaneous decoders: aggregate 588/625/628/581 fps (96 fps per stream at 6). The test clip is tagged sRGB transfer, full range; phone clips (BT.709 limited) are untested for colour. |
| Pencil and touch | iPad (UA: WebKit "Version/27.2", Brave; reports as a Mac) | **Pencil:** pressure 0.004 to 1.0 with 514+ distinct levels; tiltX -7..48, tiltY -21..53; altitude 0.57..1.47 rad; azimuth full range; twist always 0; contact size constant 0.5. About 250 samples/s (4 ms median). **Each delivered pointermove carried about 4 coalesced events** (mean 3.99), consistent with a 60 Hz display (not measured). `getCoalescedEvents` and `getPredictedEvents` exist (predicted not exercised); `pointerrawupdate` does not. **Touch:** pressure always 0, contact size 63 to 104 px, about 111 events/s. 0 touch pointerdowns while the pen was down (meaningful only if the palm was resting). Event to frame callback: median 5 ms, p95 7 ms (not photon latency). No cancelled strokes. Two-finger pinch/rotate worked. Not run: standalone (home screen) mode. **Second run (Safari 27.2, tab, palm resting):** pressure 0 to 0.547 (368 levels; lighter touch), tilt/altitude/azimuth present, twist 0, 250 Hz, 4.0 coalesced per event (max 8), event to frame median 5 ms; 1 touch pointerdown in the whole run and 0 while the pen was down. One touch sample is too few to call palm rejection proven. |

## What this means for the plan

- Export is a low risk: large headroom at 1080p60 on a simple scene. Open: thermal behaviour over 30 s or more, and heavier scenes.
- Use GPU readback as the primary export frame source; keep canvas-to-VideoFrame as a fallback.
- Video layers look feasible: on the iPad `importExternalTexture` takes under 1 ms per 1080p frame and decode runs at about 12x real time for 1080p60. Use `importExternalTexture` as the primary path; `copyExternalImageToTexture` is a reasonable fallback (about 7 ms).
- Shown on the iPad (run 2): correct pictures, frame-accurate seeking, 34 ms median seek. Still open: HEVC/4K phone clips, colour fidelity of limited-range BT.709, sustained decode of several streams under load.
- The CPU path is not available on Safari (no format conversion in `copyTo`). A YUV-to-RGB shader would be needed if a CPU fallback is ever required.
- Decode limits were not reached at 6 concurrent 1080p60 streams, but that was one H.264 clip, decode only. HEVC, 4K and mixed content are untested.

## Pencil and touch: design rules

- Read `getCoalescedEvents()` for ink; ignoring it cuts stroke resolution from about 250 Hz to the delivery rate.
- Identify the Pencil with `pointerType === "pen"` at runtime. The primary pointer reports as coarse (`(pointer: fine)` false); only `(any-pointer: fine)` is true. Do not rely on media queries or the user agent (the iPad reports as a Mac).
- Pen draws and selects; touch navigates (two-finger pan, zoom, rotate). Finger pressure is always 0 so it cannot drive anything. Finger contact size is available.
- No hover and no twist on this hardware.

## Findings worth keeping

- WGSL reserves `target` as a keyword; a struct field with that name makes the pipeline invalid.
- WebGPU `popErrorScope()` rejects with "Instance dropped" when the device has been destroyed. Catch it separately so it never hides the original error.
- Keep a reference to the GPU adapter for the renderer's lifetime. Chromium's readback failed while a canvas render loop was running; cause not found.
- Safari's `VideoFrame.copyTo` / `allocationSize` do not honour a `format` option; they use the native layout.
- A readback check against a magenta clear colour cannot tell a white or magenta picture from "nothing drawn". Check for non-clear pixels, or use a coded clip.
- `mp4-muxer` is deprecated; Mediabunny is used for demuxing/decoding here and should replace it for muxing.

## Open questions

1. iPad: HEVC and 4K phone clips (decode support, colour, seek latency on long-GOP footage).
2. Throttling on a 30 s or longer export, and on a heavier scene.
3. How many simultaneous video decoders iPadOS allows.
4. Pencil: palm rejection (run 2 saw no touch during pen use, but only one touch sample, so retest with a deliberate palm-down on the glass); whether `getPredictedEvents` returns usable points; display refresh rate; true input-to-photon latency; behaviour in standalone mode in Safari (not Brave).
