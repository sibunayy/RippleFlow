# RippleFlow

Web motion design tool for the 2022 M1 iPad Air (Apple Pencil 2, no hover). Audience: short-form creators and logo-motion designers. References: NodeVideo, Linearity Move, some After Effects and Cavalry. Live at https://sibunayy.github.io/RippleFlow/ (GitHub Pages from `main`, installable PWA).

The prototype stage is finished. Work now is bug fixing and feature refinement. Read this file, then `docs/features.md` for the feature you touch.

## Decisions that are settled (do not relitigate)

- Layers + timeline + keyframes, not a node graph. Easing curve editor is in.
- WebGPU only, iPadOS 26+, no WebGL fallback. Paths are tessellated to triangles.
- Local-first PWA (OPFS + IndexedDB). iOS can evict storage, so export/backup bundles matter.
- Export: MP4 H.264 via WebCodecs, up to 1080p60. Out: audio, pre-comps, Lottie, 4K, cloud sync.
- Web, not native Swift (user's choice).
- Visual identity and layout follow the claude.ai design canvas "RippleFlow on iPad 11 inch" (boards: Edit landscape 1180×820, Curves landscape, Motion sheet portrait 820×1180; tokens as CSS variables at the top of `src/app/app.css`). Flat, dark, mint = selected, coral = time/recording, violet = geometry editing, 44px controls, nothing under 12px, no shadows/gradients/glow (except the stage dot grid). Match those boards when restyling.

## Commands

```bash
npm run dev          # vite dev server
npm run typecheck    # tsc --noEmit
npm test             # vitest, Node only (see rule below)
npm run build
scripts/run-all-quick.sh   # typecheck + unit tests + the fast browser scripts (~5 min)
scripts/ship.sh <branch> "<title>" "<body>"   # push, open PR via REST, wait for CI, squash-merge
```

## Working rules

- You have standing permission to branch, push, open PRs and squash-merge in this repo once CI is green. Do not wait to be asked.
- Branch from fresh main: `git fetch -q origin main && git checkout -q -B <branch> origin/main`. `ship.sh` refuses if the branch is behind main (squash merges rewrite history: use `git rebase --onto origin/main <old-base>`).
- Commit and push before stopping (a stop hook flags uncommitted work). Never claim an iPad-only behaviour works: see "Not verified".
- Keep replies to the user short. They want a patch-notes message plus an iPad test list after each merge, nothing else.
- Update the matching paragraph in `docs/features.md` when behaviour changes. Do not append changelogs.
- `src/core`, `src/geometry`, `src/input` are pure: no DOM, GPU or browser APIs, so `npm test` stays Node-only. Anything needing a browser goes in `src/app`, `src/render`, `src/export`, `src/video`, `src/persist/store.ts` and is checked by a `scripts/run-*.mjs`.

## Code map: where to change what

| To change… | Look in |
| --- | --- |
| Document types (Layer, Track, Keyframe, Effect, Mask…) | `src/core/types.ts`. A new stored field also needs a parser entry in `src/persist/serialize.ts` (it strips unknown fields) |
| Any edit as an undoable command | `src/core/commands.ts` (`editLayer`, `editShape`, `sequence`); transform/move/scale commands `src/editor/transformEdit.ts` (`transformLayer`); history `src/core/history.ts` |
| What is on screen at time t (shared by preview AND export) | `src/core/scene.ts` `evaluateScene`; transforms `layerTransform.ts`; easing/keyframes `evaluate.ts`, `easing.ts` |
| Animation presets, text animator maths, effect specs | `src/core/presets.ts`, `src/core/text.ts`, `src/core/effects.ts` |
| Editor state and pointer behaviour | `src/editor/controller.ts` (selection, auto-key, pen/points/pins modes, overlays). Tools: `selectTool.ts`, `penTool.ts`, `nodeTool.ts`, `handles.ts`, `hitTest.ts`. Pure edit helpers beside them (`styleEdit`, `effectEdit`, `maskEdit`, `trimEdit`, `align`, `keyframeEdit`, `easingEdit`) |
| Shape → triangles | `src/geometry/layerGeometry.ts` (entry), `svgPath.ts`, `fill.ts`, `stroke.ts`, `trim.ts`, `warp.ts`, `lod.ts`; anchors/handles `nodes.ts`; SVG import `svgImport.ts` |
| GPU drawing | `src/render/meshRenderer.ts` (main pass), `fxEngine.ts` (effects, masks, mattes group path); scene → draws in `src/app/sceneDraws.ts` |
| Text outlines and fonts | `src/text/glyphs.ts` (layout), `fonts.ts` (registry), `textEdit.ts`; panel `src/app/TextPanel.tsx` |
| MP4 export | `src/export/exportComposition.ts`, `encodeMp4.ts`; dialog `src/app/ExportDialog.tsx` |
| Video/image media | `src/video/` (Mediabunny decode), `src/persist/assets.ts`, `src/app/images.ts` |
| Save/load, projects, backup | `src/persist/` (`serialize`, `autosave`, `projects`, `bundle`, `store`); PWA/service worker `src/app/pwa.ts`, `scripts/sw-template.js` |
| UI panels | `src/app/Editor.tsx` (shell, top bar, rail + flyouts, stage selection/mode bar), `Inspector.tsx` (tabs; Transform and Motion tabs), `Style.tsx` (Style tab), `Effects.tsx`, `Compositing.tsx`, `Timeline.tsx` (transport, Keys view, ⋯ menu), `Curves.tsx` (Curves view, Easing select), `CompSettings.tsx`, `ProjectsDialog.tsx`, `ScrubField.tsx`, `icons.tsx` |
| Look and layout | `src/app/app.css` (one stylesheet: tokens, landscape grid, then the portrait `@media (orientation: portrait), (max-width: 900px)` block near the bottom). Fonts come from `@fontsource` imports in `Editor.tsx` |
| Touch/Pencil input maths | `src/input/` (pure) |

Data flow in one line: `ctrl.execute(command)` → `Composition` (immutable) → `evaluateScene(comp, t)` → `SceneSync` + `layerDraws` (both in `src/app/sceneDraws.ts`) → `MeshRenderer`; export runs the same `evaluateScene` offscreen.

Track keys: transform props by name, effect params `fx:<effectId>:<name>`, trim `trim:start|end` (`TrackPath` in `src/editor/keyframeEdit.ts`).

`docs/phase0-results.md` has the Phase 0 device measurements (the spike pages are gone; see git history before #68 if one is needed), `docs/transform-design.md` explains per-layer transform drawing.

Claude Code read-deny rules (fonts, binaries, `public/`, lockfile, `dist/`) live in `.claude/settings.json`; do not open those files.

## Testing

- Unit tests live beside the code (`*.test.ts`); keep them Node-only.
- Browser checks are `scripts/run-<feature>.mjs "<url>?debug&noloop"`: they drive the real app with Playwright and read pixels back from an offscreen texture. Run the ones for the area you touched; `run-all-quick.sh` runs a representative set. Each script prints PASS/FAIL lines and `errors:`.
- Start the dev server with `(npx vite --port 5199 >/tmp/vite.log 2>&1 &)`, use `NODE_PATH=$(npm root -g)` for Playwright, stop it with `pkill -f "vite --port 5199"`.
- Inspector controls live in tabs: click `getByRole("tab", { name: "Style" | "Effects" | "Motion" })` first (Transform is the default). Shapes and media are in rail flyouts (`Shapes` button, then a `menuitem`). Auto-key is a button named "Auto-key off"/"Auto-key on". Number fields are named "Position X", "Scale width percent", "Rotation degrees", "Opacity percent". Undo/Redo are icon buttons named "Undo"/"Redo".
- `run-pins.mjs` and `run-opacity.mjs` need a 400×400 quadrant PNG (red/green/blue/yellow) as their extra argument; `run-graph.mjs` now drives the Curves view. Portrait screenshots with the swiftshader flags can show panel-coloured bands over the stage (compositor artifact): judge portrait layout with a `--disable-gpu` browser.
- Export changes: also run at 1080p (`PRESET="1080p · 30 fps"` for `run-export-app`, `run-image`, `run-video-layer`; `COMPAT=1` for compatibility mode) and check with ffprobe. Colour: expect native Y 235 of a white backdrop and `tv` range tags.

## Environment gotchas

- Container Chromium has only a software GPU. Flags: `--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU --use-angle=swiftshader --use-webgpu-adapter=swiftshader`.
- A WebGPU canvas screenshots blank there (UI around it is fine). `mapAsync` readback fails while a canvas is presented, so test pages use `?debug&noloop` and the `window.__rf` hook (exists only with `?debug`).
- `importExternalTexture` and `copyExternalImageToTexture` from a VideoFrame destroy the GPU device in the container: tests use `?videoMode=bitmap`. Only a real iPad can judge them.
- WGSL reserves words like `target`. `popErrorScope()` rejects with "Instance dropped" after device loss: catch it separately. Keep a reference to the `GPUAdapter` for the renderer's lifetime.
- opentype.js `toPathData(2)` can emit `NaN`: use `pathData()` in `src/text/glyphs.ts`.
- `mp4-muxer` is deprecated; Mediabunny does demux/decode and should replace it for muxing.
- Python `str.replace` of a short indented snippet also hits deeper-indented copies: use unique anchors or Edit.

## Git and GitHub

- GraphQL is blocked, so `gh pr create` fails. `scripts/ship.sh` uses the REST API (`gh api repos/sibunayy/RippleFlow/pulls --input file.json`, merge with `PUT .../pulls/N/merge`). Squash merge is the style now.
- The clone is shallow and single-branch; `ship.sh` adds the fetch refspec so the stop hook does not falsely report an unpushed commit.
- Several PRs editing the `input` list in `vite.config.ts` conflict: keep every page.
- Pages deploys from `main`; the repo's Pages source must be "GitHub Actions". The top bar shows the build id (git short sha) so a device can say which version it runs.

## Not verified on the iPad (only the user can). Do not claim these work

Pencil feel and hit-target sizes in the editor, the pen tool with a real Pencil, 1080p60 export speed and heat, share sheet to Photos, standalone home-screen behaviour, palm rejection, HEVC/4K phone clips, the `importExternalTexture` video draw inside the editor (the standalone iPad spike did verify it), the video path with the pin vertex layout, and the redesigned layout (landscape and portrait sheet) on the device.

## Known gaps (candidates for the next work)

Features not built: audio, pre-comps, clip slip, multi-select, per-property text animators, user-imported fonts, text on a path, canvas text editing, pin stiffness and video/shape warp, backdrop-copy blend modes (overlay etc.), points keyframing. Details per feature are in `docs/features.md`.
