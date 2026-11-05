# RippleFlow

Web-based motion design tool for the 2022 M1 iPad Air (Apple Pencil 2, no hover).
Audience: short-form creators and logo-motion designers. Closest references:
NodeVideo and Linearity Move, with some After Effects and Cavalry ideas.

## MVP decisions (made with the user)

- Layers + timeline + keyframes (not a node graph). Graph/easing curve editor is in.
- WebGPU only, iPadOS 26+, no WebGL fallback. Paths are tessellated to triangles.
- Assets: SVG, shapes, images, video clips. Text is static outlines at most. Out for the MVP: audio, precomps, masks, effects stack, per-character text animators, Lottie export, 4K, cloud sync.
- Export: MP4 (H.264) via WebCodecs, up to 1080p60.
- Local-first installable PWA (OPFS + IndexedDB). Export/backup is needed because iOS can evict storage.
- Native Swift was considered and rejected; the user chose web.

## Commands

```bash
npm run dev         # vite dev server
npm run typecheck
npm test            # vitest, Node environment: src/core, geometry and input code must not need a browser
npm run build
```

## Layout

- `src/core/`: pure document model, affine math, keyframe/easing evaluation, layer transforms, scene evaluator, undo history. No DOM or GPU.
- `src/geometry/`: SVG path parsing, flattening, fill (earcut) and stroke tessellation, LOD policy. Pure.
- `src/render/`: WebGPU renderers (`meshRenderer.ts`, `videoQuad.ts`).
- `src/export/`: WebCodecs MP4 exporter.
- `src/input/`: pointer stats and two-finger gesture math. Pure.
- `src/spike/` + root `*.html`: device test pages (spike, export, video, input). Live at https://sibunayy.github.io/RippleFlow/.
- `docs/phase0-results.md`: measured results. `docs/transform-design.md`: why meshes are drawn through per-layer transforms.

## Environment gotchas (found the hard way)

- Cloud container Chromium has only a software GPU. WebGPU needs flags: `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU --use-angle=swiftshader --use-webgpu-adapter=swiftshader`. Playwright is preinstalled (use `NODE_PATH=$(npm root -g)`).
- A WebGPU canvas screenshots blank there. Verify rendering by reading pixels back from an offscreen texture instead.
- There, `copyExternalImageToTexture` from a VideoFrame and `importExternalTexture` destroy the GPU device. They can only be judged on a real iPad.
- `mapAsync` readback failed while a `requestAnimationFrame` canvas render loop ran. Cause unknown.
- WGSL reserves words like `target`. `popErrorScope()` rejects with "Instance dropped" after a device loss: catch it separately so it cannot hide the original error.
- Keep a reference to the GPUAdapter for the renderer's lifetime.
- `mp4-muxer` is deprecated; Mediabunny is used for demux/decode and should replace it for muxing.

## Git and GitHub in this environment

- GraphQL is blocked: `gh pr create` fails. Create PRs with `gh api repos/sibunayy/RippleFlow/pulls --input file.json`, mark ready with `POST .../pulls/N/ccr/ready_for_review`, merge with `PUT .../pulls/N/merge -f merge_method=merge`.
- Only merge when the user says so explicitly. Merge style so far: merge commit.
- The clone is shallow and single-branch. After pushing a new branch, add a fetch refspec for it (`git config --add remote.origin.fetch '+refs/heads/B:refs/remotes/origin/B'`, then `git fetch origin B` and `git branch -u origin/B`), otherwise the stop hook falsely reports an unpushed commit.
- Stacked PRs: merging a PR into its base branch does not put it on `main`. Merge the base first, then retarget.
- Several PRs editing the `input` list in `vite.config.ts` conflict; resolve by keeping every page.
- Pages deploys from `main`; the repo's Pages source must be "GitHub Actions".

## Status

Phase 0 is done (see `docs/phase0-results.md`). Built and merged, container-verified by driving the real app (`scripts/run-*.mjs`, offscreen readback, ffmpeg on exported files):

- M1 editor shell: pen/mouse select, move, scale, rotate; touch pans/zooms/rotates the view; undo/redo.
- M2 timeline: layer rows, keyframe diamonds (retime, delete), trim bars, numeric properties, auto-key.
- M3 easing editor: bezier handles and presets per keyframe segment.
- M5 persistence and PWA: validated versioned format, OPFS autosave, offline service worker with update prompt.
- M6 export: offscreen render to H.264 MP4 with share/download.
- M4 media: image layers (OPFS assets by content hash, downscale to 2048) and video layers (Mediabunny sequential/seek decode, external-texture draw, rotation metadata, in export too). Video layers plays from `video.start`; in/out points only gate visibility.

Not built: SVG import, project list/naming, file open/save, text, audio (video clips export silent), composition size/fps UI, slipping/moving a clip on the timeline.

Not verified anywhere: the `importExternalTexture` video draw inside the real editor (the container's software GPU destroys the device on it, so tests use `?videoMode=bitmap`; the iPad spike did verify external textures standalone). Not verified on the iPad (only the user can): Pencil feel and hit-target sizes in the editor, 1080p60 export speed and heat on a real scene, share sheet to Photos, standalone (home-screen) behaviour, palm rejection with a resting palm, HEVC/4K phone clips. Do not claim these work.

Container gotchas: the software GPU cannot read back a buffer while a canvas is being presented, so test pages use `?debug&noloop` and the `window.__rf` hook (no canvas present, manual frames).

Export colour: the encoder's own colour tags cannot be trusted (Safari tags full range on limited-range data). The exporter feeds NV12 it converted itself and writes its own `colr`; check any export change with ffprobe tags plus native Y of a white backdrop (expect 235, `tv`).

Auto-key: a property with no keys gets a base keyframe at 0 holding its old value before its first keyframe after time 0 (a lone keyframe would just hold its value at every time and nothing would animate). Position already had a base key from layer creation, which is why it was the only property that animated before this was fixed.
The toolbar shows the build id (git short sha), so a device can say which version produced a file.
