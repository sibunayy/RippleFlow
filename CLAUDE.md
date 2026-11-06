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

Projects: several projects in OPFS (`p-…` ids, `rf.current` in localStorage remembers the open one), project list dialog (new/open/rename/duplicate/delete), single-file `.rippleflow` backup bundle (project + media) in `src/persist/bundle.ts`. Number fields scrub by dragging (`ScrubField`, `ctrl.setPreview`).

Style: per-layer blend (normal/multiply/screen/add: only modes the fixed GPU blend stage does exactly on an opaque backdrop; overlay etc. need a backdrop copy and are not built), fill none/solid/linear/radial gradient (per-pixel shader over the fill bbox, up to 8 stops), stroke colour/width/join/cap, in the Style side panel (`src/app/Style.tsx`, pure edits in `src/editor/styleEdit.ts`). Colour pickers are native `<input type=color>`.

Point editing: toolbar Points button edits the selected shape's anchors and bezier handles (`src/geometry/nodes.ts` model + ops, `src/editor/nodeTool.ts` pen interaction, controller `pointEdit`/`nodeOverlay`/`nodeAction`). Shape paths are rewritten as plain M/L/C/Z strings on the first edit. Tap a point to select, drag points/handles, tap the outline to add a point, Smooth/Corner/Delete in the bar. Points are static (not keyframed).

Pen tool: toolbar Pen draws a new shape layer (tap = corner, drag = curve, tap first point = close; closed → fill, open → stroke) via `src/editor/penTool.ts` (pure) and controller `startPen/finishPen/penOverlay`; Style > Compositing > Masks "+ Draw" draws a mask in layer-local space. Script `scripts/run-pen.mjs`. Not tried with a real Pencil.

Effects: `Layer.effects` stack (blur, drop shadow, glow, noise, levels, brightness/contrast, exposure, hue/saturation, tint, invert, posterize), numbers are keyframable Tracks (`src/core/effects.ts` spec table, `editor/effectEdit.ts`). Rendering is the compositing engine in `src/render/fxEngine.ts`: a layer with effects is drawn alone into a texture (a `GroupInfo` shared by its draws), effects run as full-screen passes (textureLoad, premultiplied), then it is composited with opacity and blend. Plain layers still use the single MSAA pass. Spatial values (blur radius, distance) are composition units, scaled to device pixels in `drawsFor`. Matte/mask would reuse this path.

Masks and mattes: `Layer.masks` (add/subtract/intersect, feather, opacity, invert; static layer-local paths, point-editable) and `Layer.matte` (alpha/luma, normal/inverted) plus `Layer.hidden`. They use the same group path as effects: masks, then effects, then matte, then composite (`GroupInfo.masks/matte`, draws tagged `role`). `evaluateScene` embeds the matte source's own SceneItem. Style panel > Compositing (`src/app/Compositing.tsx`). Pixel tests: `scripts/run-matte.mjs`, UI: `run-matte-ui.mjs`.

Text: toolbar Text adds a text layer (a shape layer plus `Layer.text`; `shape.path` holds the glyph outlines, rebuilt by `src/text/textEdit.ts` whenever text/size/tracking/align/animator change). Font: bundled Inter Bold (OFL, `src/text/fonts/`) parsed with opentype.js (`src/text/glyphs.ts`, loaded before the app renders). Animator (Style > Text): per character/word/line stagger of opacity/offset/scale/rotation with start, stagger, duration, ease (`src/core/text.ts`, `SceneItem.units`, geometry parts tagged `unit`/`pivot`, applied in `layerDraws`). Fonts: Text panel Font picker (Inter Bold default, Poppins Bold, Bebas Neue, Playfair Bold, Pacifico, Space Mono Bold; `src/text/fonts.ts` registry, `TextContent.font`, loaded lazily with `ensureFont`, WOFF latin subsets so other scripts draw nothing, OFL texts beside the files; `scripts/run-fonts.mjs`). Not built: per-property animator tracks, range selectors, user-imported fonts, text on a path, editing text on canvas. Scripts `run-text.mjs`; export of animated text checked via ffmpeg.

Puppet pins (mesh warp) on image layers: toolbar Pins, tap to pin, drag to pull (auto-key records); `ImageContent.pins` with keyframable dx/dy, `src/geometry/warp.ts` (24x24 grid, inverse-distance blend), `SceneItem.pins`, warped mesh rebuilt per frame and updated in place (`Mesh.key`, `SceneSync` + `MeshRenderer.setMesh`). Picture/video draws now use a (x,y,u,v) vertex buffer (`Mesh.uvs` optional). Container-verified for images (`scripts/run-pins.mjs`); the video external-texture path with the new vertex layout is NOT verified (container GPU cannot). Not built: pin stiffness/rigid regions, video warp, pin on text/shapes.

Timeline layer controls: Duplicate (fresh keyframe/effect/mask ids), Rename (window.prompt), eye toggle, indent by parent depth, Raise/Lower, and a ⠿ grip on each label to drag-reorder (`scripts/run-reorder.mjs`). `scripts/run-layers.mjs`. Not built: pre-comps (nested compositions).

Null layers and parenting: toolbar Null adds an empty transform layer; Props "Parent" picker parents any layer to another (cycles not offered; transform only, opacity is not inherited). Script `scripts/run-parent.mjs`. No group/pre-comp yet.

Composition settings: toolbar Comp opens `src/app/CompSettings.tsx` (size presets 16:9/9:16/1:1/4:5, custom W/H up to 4096, fps, length, background; `setCanvas`/`setBackground` in commands; view refits on size change). `scripts/run-comp.mjs`. Layers are not rescaled when the size changes.

Clip move: drag a layer's bar body on the timeline (`moveLayerInTime`: range, all keyframes and video start shift together, clamped to the composition; `scripts/run-slide.mjs`).

SVG import: toolbar SVG imports a file as editable shapes (`src/geometry/svgImport.ts`, pure regex tokenizer so it runs under Node): path/rect/circle/ellipse/line/polyline/polygon, g transforms, viewBox, fill/stroke/opacity from attributes, style attrs and simple `<style>` class rules. One shape layer per element, parented to a fitted null group layer. Linear/radial gradient fills are approximated onto the app's bbox gradient (userSpaceOnUse, gradientTransform, href stops; radial centre assumed at the box centre). Left out (reported in a notice): patterns and gradient strokes (flat grey), clip/mask/filter, `<use>`, text, embedded images. `scripts/run-svg.mjs`.

Animation presets: Props panel buttons (Fade/Pop/Slide up/Slide in/Spin in, and Fade/Pop/Slide down/Spin out) write keyframes relative to the layer's settled values: in at the layer in-point, out at its out-point (`src/core/presets.ts`, `applyPreset`; re-applying replaces the keys in that span). A layer with children (an SVG group, a null) also shows a "Children" row: the same presets applied to each direct child with a Stagger (seconds) offset between them (`applyPresetToChildren`; in presets start later, out presets finish earlier; ranges are untouched). `scripts/run-presets.mjs`, `scripts/run-stagger.mjs`.

Align: six buttons in the Props panel align the selected layer to the composition edges/centres (`src/editor/align.ts`, controller `alignSelected`). A layer with no shape of its own (an SVG group, a null) aligns the union box of everything parented under it. Uses the box at the playhead and respects auto-key. `scripts/run-align.mjs`.

Trim paths: Style > Stroke has Trim start/end % (keyframable with auto-key) that draw a stroke on/off along its length (`ShapeContent.trim`, `src/geometry/trim.ts` slices the flattened outline by arc length, `ShapePart.trimAt` builds the trimmed stroke, cached by range; `src/editor/trimEdit.ts`). The scene item carries `trim`, so export matches. While the range animates the scene buffers are re-uploaded each frame (no in-place path yet). Trim and effect keys show as timeline diamonds (`TrackPath` in `src/editor/keyframeEdit.ts`: "x", "fx:<id>:<name>", "trim:start"); they move, delete and take easing like transform keys (`scripts/run-fxkeys.mjs`). `scripts/run-trim.mjs`.

More shapes: toolbar "More…" menu adds rounded rect, triangle, hexagon, plus, arrow, heart and a stroked line (`MORE_SHAPES` in `src/app/shapes.ts`). `scripts/run-shapes.mjs`.

Look: "Luminous Instrument" (`src/app/theme.css`, loaded after `app.css`, colour/radius/spacing/type only): ink background, floating rounded islands (top bar, canvas, Style panel, Props, timeline, transport), mint = action/selection, coral = time/tension (playhead, pins), violet = bezier handles, italic serif for names, mono for numbers. Uses system fonts (ui-serif/ui-rounded/ui-monospace) so it works offline. Shell: top bar = project name + save state, centre transport pill (play, mono time, Auto-key), right Comp/Transform/Style toggles, undo/redo, Export; a floating left tool rail over the canvas (`Tool` in Editor.tsx); Style panel on the right; timeline at the bottom. Transform/align/presets (`Props`) are tucked into a popover (`.props-pop`, Transform toggle, closed by default; scripts that need it click Transform first). The old bottom transport bar is gone. The old bottom transport bar is gone. Not built: audio (video clips export silent), slipping a clip (changing which part plays without moving it).

Not verified anywhere: the `importExternalTexture` video draw inside the real editor (the container's software GPU destroys the device on it, so tests use `?videoMode=bitmap`; the iPad spike did verify external textures standalone). Not verified on the iPad (only the user can): Pencil feel and hit-target sizes in the editor, 1080p60 export speed and heat on a real scene, share sheet to Photos, standalone (home-screen) behaviour, palm rejection with a resting palm, HEVC/4K phone clips. Do not claim these work.

Container gotchas: the software GPU cannot read back a buffer while a canvas is being presented, so test pages use `?debug&noloop` and the `window.__rf` hook (no canvas present, manual frames).

Export colour: the encoder's own colour tags cannot be trusted (Safari tags full range on limited-range data). The exporter feeds NV12 it converted itself and writes its own `colr`; check any export change with ffprobe tags plus native Y of a white backdrop (expect 235, `tv`).

Auto-key: a property with no keys gets a base keyframe at 0 holding its old value before its first keyframe after time 0 (a lone keyframe would just hold its value at every time and nothing would animate). Position already had a base key from layer creation, which is why it was the only property that animated before this was fixed.
The toolbar shows the build id (git short sha), so a device can say which version produced a file.
Export checks must include 1080p, not just 720p: 1280 is a multiple of 256 so GPU row padding vanishes, 1920 is not. Safari mishandled padded NV12 `layout`; frames are now tightly packed with no layout. Set `PRESET="1080p · 30 fps"` for scripts/run-export-app.mjs, run-image.mjs, run-video-layer.mjs (and `COMPAT=1` for compatibility mode).
