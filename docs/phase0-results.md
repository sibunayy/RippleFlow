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
| Video into WebGPU | iPad, Safari 27.2, phone-origin .MOV | **A real clip, but small and easy: 480x360 H.264 Baseline (avc1.42001e), 4.88 s, 117 frames** (looks like a messaging-app re-encode, not original camera footage). Decodes and draws on all three GPU paths (picture presence only; frame index and colour not checked). Decode 2,489 fps. Upload+draw: `importExternalTexture` 0.58 ms, `copyExternalImageToTexture` 1.5 ms, `ImageBitmap` 3.1 ms. Seek median 11 ms (p95 16). 6 decoders: 2,304 fps aggregate. These numbers are about 27x fewer pixels than 1080p, so they do not predict 1080p or 4K phone footage. Safari reports the same colour-space string (bt709, sRGB transfer, full range) for this clip as for the test clip, so that field is not informative about the source. **Still untested: HEVC, 4K, original camera files, and colour accuracy.** |
| Video into WebGPU | iPad, Safari 27.2, our own 1080p60 export | A full 1080p H.264 High clip (`avc1.64002a`, 600 frames; produced by the export spike, keyframe every 2 s). Picture drawn on all three GPU paths (frame index and colour not checked). Decode 741 fps. `importExternalTexture` 0.73 ms, `copyExternalImageToTexture` 6.5 ms, `ImageBitmap` 16.4 ms. **Seek median 101 ms, p95 170 ms**, about 3x the coded test clip's 34 ms. Likely cause: seeking decodes forward from the nearest earlier keyframe, and this clip has up to 120 frames between keyframes (about 60 on average, at roughly 740 fps decode is about 80 ms). Not confirmed by inspecting the file. Implication: scrub latency depends on the source clip's keyframe spacing; consider a frame cache or decode-ahead around the playhead. 6 decoders: 664 fps aggregate. |
| Video into WebGPU | iPad, Safari 27.2, camera-roll clip `IMG_0059.mov` | **A real 1080p camera-roll clip:** H.264 High level 4.0 (`avc1.640028`), 1920x1080, 4.29 s, 128 frames (so about 30 fps). It is H.264, not HEVC, so the HEVC question is still open (the file may have been exported as "Most Compatible" or was recorded in that mode). Drawn correctly on all three GPU paths (picture presence only; frame index and colour not checked). Decode 601 fps. `importExternalTexture` 0.67 ms (526 fps sequential), `copyExternalImageToTexture` 6.7 ms, `ImageBitmap` 16.9 ms. **Seek median 28 ms, p95 54 ms, max 57 ms** (24 seeks; frame accuracy not checked on this clip). 1/2/4/6 decoders: 492/506/512/511 fps aggregate (85 fps per stream at 6). Safari again reports bt709 / sRGB transfer / full range, so that string says nothing about the source. |
| Pencil and touch | iPad (UA: WebKit "Version/27.2", Brave; reports as a Mac) | **Pencil:** pressure 0.004 to 1.0 with 514+ distinct levels; tiltX -7..48, tiltY -21..53; altitude 0.57..1.47 rad; azimuth full range; twist always 0; contact size constant 0.5. About 250 samples/s (4 ms median). **Each delivered pointermove carried about 4 coalesced events** (mean 3.99), consistent with a 60 Hz display (not measured). `getCoalescedEvents` and `getPredictedEvents` exist (predicted not exercised); `pointerrawupdate` does not. **Touch:** pressure always 0, contact size 63 to 104 px, about 111 events/s. 0 touch pointerdowns while the pen was down (meaningful only if the palm was resting). Event to frame callback: median 5 ms, p95 7 ms (not photon latency). No cancelled strokes. Two-finger pinch/rotate worked. Not run: standalone (home screen) mode. **Second run (Safari 27.2, tab, palm resting):** pressure 0 to 0.547 (368 levels; lighter touch), tilt/altitude/azimuth present, twist 0, 250 Hz, 4.0 coalesced per event (max 8), event to frame median 5 ms; 1 touch pointerdown in the whole run and 0 while the pen was down. One touch sample is too few to call palm rejection proven. |
| Pencil and touch | iPad, Safari 27.2, **standalone (home screen)** | 9 pen strokes (1,761 events) and 6 touch pointerdowns (652 events, two-finger zoom 0.83x to 3.46x, 7 degrees rotation). Pen: pressure 0 to 0.417 (311 levels), tilt/altitude/azimuth present, twist 0, 250 Hz, 3.97 coalesced per delivered event (max 4). Touch: 111 Hz, 1.6 coalesced, contact 63 to 104 px. About 4 pen samples per frame implies a 60 Hz display (inferred, not measured). **0 touch pointerdowns while the pen was down, across 9 strokes** (whether the palm was actually resting is the tester's account, not measured). Event to frame: median 6 ms, p95 22 ms, max 214 ms (one outlier; `anomalies: 1`); handler delay median 5 ms, p95 15 ms. Tester: "feels great". Numbers are close to the tab runs (p95 event-to-frame is 22 ms here against 5 to 7 ms before, from one outlier-heavy run). |

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

1. iPad: HEVC and 4K clips (a real 1080p H.264 camera-roll clip now works, 28 ms median seek): decode support, colour accuracy against a known reference, seek latency on long-GOP footage.
2. Throttling on a 30 s or longer export, and on a heavier scene.
3. How many simultaneous video decoders iPadOS allows.
4. Pencil: palm rejection (runs 2 and 3, the latter in standalone mode, saw no touch during pen use; the tester later reported palm rejection "is good" in hand use, which is their observation, not a measurement); whether `getPredictedEvents` returns usable points; display refresh rate (about 60 Hz is inferred from 4 pen samples per frame); true input-to-photon latency.

## Export colour range (found from a real iPad export)

The user uploaded an MP4 exported by the app on the iPad (1080p30, 6 s, keyframe every 1 s). Measured with ffprobe/ffmpeg:

- The white backdrop decodes to RGB 233 to 235, not 255, and the orange rectangle is 231,174,55 instead of the 250,184,51 that was drawn. Native luma of the backdrop is 233 to 235.
- The file's `colr` box says BT.709 primaries, **sRGB transfer, full range**. The SPS has no VUI block, so `colr` is the only colour tag.
- So Safari's H.264 encoder produced **limited-range** samples (white = about 235) while reporting **full range**. `mp4-muxer` copied the encoder-reported colour space into `colr`. Players that honour the tag show white as light grey and blacks as dark grey (contrast compressed to 16..235).
- Chromium in the container reports the same tag but its samples really are full range, so the bug does not reproduce there.

Fix: the exporter now converts RGB to BT.709 limited-range NV12 on the GPU (`src/render/nv12Readback.ts`), hands the encoder those planes with an explicit colour space, and writes its own `colr` (BT.709, limited). Container check: native Y/U/V within 1 of the reference, white backdrop Y=235, decoded white 255. **Not yet verified on the iPad:** that Safari's encoder passes NV12 input through unchanged and does not re-tag or re-convert it. Verify by exporting again and checking `ffprobe` colour tags and native luma of a white backdrop (expect Y=235, tag `tv`).
