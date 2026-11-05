# RippleFlow MVP plan (revised after Phase 0)

Supersedes the first plan. Everything marked "measured" comes from the M1 iPad
Air; see `docs/phase0-results.md`. Sizes (S/M/L) are relative guesses, not
estimates in calendar time.

## Verdict

**Go.** The risky platform pieces work on the target device. What remains is
mostly product engineering (editor UI, persistence, media handling), plus a few
unknowns that only heavier scenes will reveal.

| Question | Answer | Basis |
|---|---|---|
| Can WebGPU draw logo-grade vectors? | Yes | tessellation spike renders correctly on the iPad |
| Can we export 1080p60 MP4 in the browser? | Yes, 2.6x real time | measured, simple scene, 10 s |
| Can we put decoded video into WebGPU? | Yes, under 1 ms/frame | measured with `importExternalTexture`; picture correctness and seeking still to be confirmed |
| Does the Pencil give enough data? | Yes | 514+ pressure levels, tilt, about 250 Hz, coalesced events |
| Will it throttle on long or heavy exports? | Unknown | only a 10 s simple scene so far |

## What the device data decided

- **Export:** GPU readback to `VideoFrame` is the primary frame source (faster than canvas capture on the iPad). Keep canvas capture as a fallback.
- **Video layers:** `importExternalTexture` is the primary upload path (0.82 ms per 1080p frame). `copyExternalImageToTexture` (6.8 ms) is the fallback. There is **no CPU fallback** on Safari: `copyTo` will not convert to RGBA.
- **Ink:** read `getCoalescedEvents()` (about 4 per delivered event). Use `getPredictedEvents()` only after testing it.
- **Input roles:** pen draws and selects; touch navigates. Detect the pen with `pointerType === "pen"`, never with media queries or the user agent.
- **Platform gate:** WebGPU needs iPadOS 26+; feature-detect, never sniff the UA.

## MVP scope

**In**
- Layers: shape, image, video. SVG import (paths, fills, strokes).
- Transforms (anchor, position, scale, rotation, opacity), parenting, layer in/out trim.
- Keyframes with cubic-bezier easing and a graph/easing editor.
- Trim-paths style "draw on" for strokes (see Open design questions).
- Pencil and touch editing: select, move, draw shapes, two-finger navigation.
- Undo/redo. Local-first projects (autosave, export/import a project file). Installable PWA.
- MP4 export, 1080p up to 60 fps, presets for 9:16, 1:1, 16:9.

**Out (post-MVP, roughly in this order)**
Audio, static text, effects, masks, text animators, precomps, Lottie export, 4K, cloud sync, collaboration.

Audio is the likely first addition: video clips will export **silent** in the MVP,
and the UI must say so.

## Architecture (what exists today)

```
Composition (immutable)  --evaluateScene(t)-->  SceneItem[] (matrix, opacity, kind)
        ^                                              |
   History + commands                                  v
 (undo/redo, cycle checks)                    renderers (meshes, video quads)
                                                       |
                                  canvas (preview)  or  readback -> VideoEncoder -> MP4
```

- Preview and export share `evaluateScene`, so they cannot drift.
- Meshes are tessellated once in local space and drawn through a per-layer transform; geometry is rebuilt only when a path or stroke changes or the layer is zoomed past its built scale (`docs/transform-design.md`).
- All of `src/core`, `src/geometry` and `src/input` is pure and tested in Node. The browser-only code is `src/render`, `src/export` and the UI.

## Milestones

Each milestone ends with something you can try on the iPad. "Container" means I
can verify it myself; "iPad" means only your device can.

| # | Milestone | Size | Exit criteria | Verified by |
|---|---|---|---|---|
| M1 | **Editor shell**: Solid UI, canvas viewport (two-finger pan/zoom/rotate), tool bar, pen draws shapes, select and move layers with handles, wired to History | L | Draw, select, move, undo on the iPad without UI glitches | container logic + iPad feel |
| M2 | **Timeline**: layer stack, scrub, play, add and move keyframes, trim layers, touch-sized controls | L | Animate a shape with 3 keyframes and play it back at 60 fps | iPad |
| M3 | **Graph editor**: bezier handles per keyframe segment, presets | M | Edit an ease with the Pencil and see the motion change | container math + iPad feel |
| M4 | **Media**: SVG import, images, video layers (Mediabunny demux, `importExternalTexture`, frame cache) | L | Import a phone clip, scrub and play it, move and scale it as a layer | iPad |
| M5 | **Persistence and PWA**: project format, autosave to OPFS/IndexedDB, `storage.persist()`, export/import bundle, manifest and offline cache | M | Close and reopen without loss; work offline from the home screen | iPad (Safari) |
| M6 | **Export and polish**: export UI, presets, progress and cancel, error recovery, a few templates, onboarding | M | Export a real project to a file that plays in Photos | iPad |

Order is deliberate: the editor (M1, M2) is what makes this a product and
everything else hangs off it; media (M4) comes after the model is stable.

## Risks and unknowns, ranked

1. **Heavier scenes and heat.** Only a simple 10 s scene is measured. Mitigation: build a benchmark scene (many layers, video, strokes) early and run 30 s and 60 s exports on the iPad.
2. **Phone clips.** iPhone video is often HEVC, sometimes 4K, sometimes variable frame rate. Only H.264 1080p is tested. Needs a test with real clips before M4.
3. **Seek and scrub latency** for video: unverified on the iPad (re-run `/video.html` with the coded clip).
4. **Stroke rendering quality.** Overlapping stroke pieces double-blend when semi-transparent; opacity on a group of strokes needs an offscreen layer or merged geometry.
5. **Input latency.** Measured only to our own frame callback. True latency is unknown. Predicted events are untested.
6. **Storage eviction on iOS.** Needs `storage.persist()` and a visible backup path; behaviour must be tested in Safari standalone mode (not yet run; the tests so far used Brave).
7. **Dev loop.** The renderer and feel can only be judged on the iPad. Mitigation: keep logic pure and tested here; ship small JSON-reporting test pages; batch iPad checks per milestone.
8. **Dependencies.** `mp4-muxer` is deprecated (move to Mediabunny's muxer).

## Open design questions

- **Trim paths:** rebuild the stroke geometry per frame on the CPU (simple, costs tessellation time), or add an arc-length attribute and cut in the shader (more work, no rebuild). Start with CPU; measure.
- **Group opacity:** render to an offscreen texture per group, or merge stroke geometry. Needed for risk 4.
- **Text:** static outlines via font loading, or defer entirely. Default: defer.

## Immediate next steps

1. Merge the open PRs (#7 core and CLAUDE.md, #8 video checks and results).
2. iPad: re-run `/video.html` **without picking a file**, in Safari. Also try one HEVC phone clip.
3. iPad: Pencil palm test with the palm actually resting; Safari "Add to Home Screen" and repeat `/input.html`.
4. Start M1 (container-verifiable parts first: tool state machine, selection, hit testing, handle math).
5. Small spikes to run alongside: refresh-rate measurement, `getPredictedEvents` usefulness, group-opacity approach.

## Defaults I will proceed with unless told otherwise

- Safari standalone PWA is the target, not Brave or Chrome.
- No audio, no text, no effects in the MVP.
- CPU trim paths first.
- One human (you) on the iPad as the test loop; Claude Code builds and verifies everything else.
