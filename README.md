# RippleFlow

**A motion design tool that runs in the browser and is built for the iPad and Apple Pencil.**

Layers, a timeline, keyframes and easing curves, for short-form video and logo motion. Everything is stored on your device and the app installs as a home-screen PWA. It exports MP4 (H.264) straight from the browser.

**Try it:** https://sibunayy.github.io/RippleFlow/ (Safari on iPadOS 26+, or a recent Chromium browser with WebGPU)

> Status: prototype, now in bug-fixing and refinement. It is developed against a 2022 iPad Air (M1) with an Apple Pencil 2. Nothing here has been tested on other devices beyond a desktop Chromium used for automated checks.

## What you can do

- **Draw and import:** rectangles, ellipses, stars and more shapes, a pen tool with bezier handles, point editing, SVG import, images, video clips, text (six bundled fonts) and null layers for parenting.
- **Animate:** keyframes on position, scale, rotation and opacity, auto-key, per-segment easing with a bezier curve editor, animation presets (fade, pop, slide, spin) with child stagger, trim paths, text animators per character, word or line, and puppet pins that warp images.
- **Style:** solid and gradient fills, strokes, blend modes, a stack of effects (blur, shadow, glow, noise, colour adjustments), masks and track mattes.
- **Compose:** presets for 16:9, 9:16, 1:1 and 4:5, custom sizes up to 4096, frame rate and length.
- **Keep your work:** several projects with autosave, and a single-file `.rippleflow` backup that bundles the project and its media. iOS can evict browser storage, so use the backup for anything you care about.
- **Export:** MP4 up to 1080p60 with the same renderer as the preview.

Pencil draws and edits. One finger pans and zooms the canvas. The interface follows its own design system: dark, flat, 44px touch targets, mint for selection, coral for time.

## Not built yet

Audio, pre-comps (nested compositions), clip slipping, multi-select, Lottie export, 4K, cloud sync, user-imported fonts, text on a path and editing text on the canvas. The full per-feature list is in [`docs/features.md`](docs/features.md).

## Not yet verified on a real iPad

Pencil feel in the editor, 1080p60 export speed and heat, sharing to Photos, home-screen standalone behaviour and palm rejection. Reports from a device are the most useful contribution right now.

## Tech

TypeScript, [Solid](https://www.solidjs.com/), Vite and Vitest. Rendering is WebGPU only (paths are tessellated to triangles with earcut), with no WebGL fallback. Video decode and demux use Mediabunny, export uses WebCodecs, and text outlines come from opentype.js. Storage is OPFS plus IndexedDB.

## Develop

```bash
npm install
npm run dev          # vite dev server
npm run typecheck
npm test             # vitest, Node only
npm run build
```

Browser-level checks live in `scripts/` and drive the real app with Playwright (`scripts/run-all-quick.sh` runs a representative set). WebGPU needs a real or software GPU: see the environment notes in [`CLAUDE.md`](CLAUDE.md).

## Contributing and agent notes

[`CLAUDE.md`](CLAUDE.md) is the entry point for anyone (human or AI agent) changing the code: settled decisions, a "where to change what" map, testing and release workflow. [`docs/`](docs/) has the Phase 0 measurements, the transform design note and the feature reference.

## Licence

No licence file has been added yet, so all rights are reserved by default. The bundled fonts keep their own SIL Open Font Licence texts beside the font files in `src/text/fonts/`.
