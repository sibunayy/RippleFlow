import { exportMp4, type ExportResult } from "../export/encodeMp4";
import { MeshRenderer } from "../render/meshRenderer";
import { buildLogo } from "./logo";

declare global {
  interface Window {
    __export?: { done: boolean; error?: string; result?: Omit<ExportResult, "blob">; env?: Record<string, unknown> };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
for (const [key, id] of [["size", "size"], ["fps", "fps"], ["dur", "dur"], ["mbps", "mbps"], ["mode", "mode"]] as const) {
  const v = params.get(key);
  if (v) ($(id) as HTMLInputElement).value = v;
}

async function run() {
  const [width, height] = $<HTMLSelectElement>("size").value.split("x").map(Number) as [number, number];
  const fps = Number($<HTMLSelectElement>("fps").value);
  const durationSec = Number($<HTMLInputElement>("dur").value);
  const bitrate = Number($<HTMLInputElement>("mbps").value) * 1_000_000;
  const mode = $<HTMLSelectElement>("mode").value as "canvas" | "readback";
  const out = $("out");
  const progress = $("progress");
  $("result").innerHTML = "";
  out.textContent = "";
  window.__export = { done: false };

  const canvas = $<HTMLCanvasElement>("c");
  canvas.width = width;
  canvas.height = height;

  try {
    const renderer = await MeshRenderer.create(canvas);
    renderer.clearColor = { r: 1, g: 1, b: 1, a: 1 };
    const scale = Math.min(width, height) / 512;
    const draws = buildLogo(scale);
    renderer.setScene(draws);
    const readback = mode === "readback" ? renderer.createReadback() : null;

    // Rotate the whole logo about the canvas centre each frame. This changes every
    // edge pixel, so the encoder does real work, unlike a static scene.
    const base = draws.map((d) => d.mesh.positions);
    const scratch = base.map((p) => new Float32Array(p.length));
    const cx = (512 * scale) / 2;
    const cy = cx;
    const tx = width / 2;
    const ty = height / 2;
    const animate = (t: number) => {
      const a = t * (Math.PI / 2); // 90 degrees per second
      const c = Math.cos(a);
      const s = Math.sin(a);
      base.forEach((p, i) => {
        const o = scratch[i]!;
        for (let k = 0; k < p.length; k += 2) {
          const x = p[k]! - cx;
          const y = p[k + 1]! - cy;
          o[k] = tx + x * c - y * s;
          o[k + 1] = ty + x * s + y * c;
        }
        renderer.updatePositions(i, o);
      });
    };

    const bgra = renderer.format === "bgra8unorm";
    const result = await exportMp4(
      { width, height, fps, durationSec, bitrate },
      async (index, timestamp, duration) => {
        animate(index / fps);
        if (readback) {
          const data = await readback.read();
          return new VideoFrame(data, {
            format: bgra ? "BGRA" : "RGBA",
            codedWidth: width,
            codedHeight: height,
            timestamp,
            duration,
            layout: [{ offset: 0, stride: readback.bytesPerRow }],
          });
        }
        renderer.render();
        return new VideoFrame(canvas, { timestamp, duration });
      },
      (done, total) => {
        if (done % 10 === 0 || done === total) progress.textContent = `Frame ${done} / ${total}`;
      },
    );

    const { blob, ...summary } = result;
    const env = {
      mode,
      width,
      height,
      fps,
      durationSec,
      mbps: bitrate / 1e6,
      format: renderer.format,
      deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      jsHeapMB: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ? Math.round((performance as Performance & { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1e6)
        : null,
    };
    window.__export = { done: true, result: summary, env };
    out.textContent = JSON.stringify({ ...summary, env }, null, 2);

    const url = URL.createObjectURL(blob);
    $("result").innerHTML = `<video src="${url}" controls playsinline muted></video><p><a download="rippleflow-spike.mp4" href="${url}">Download MP4 (${(blob.size / 1e6).toFixed(1)} MB)</a></p>`;
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    window.__export = { done: true, error };
    out.textContent = `Error: ${error}`;
  }
}

const btn = $<HTMLButtonElement>("run");
btn.addEventListener("click", async () => {
  btn.disabled = true;
  await run();
  btn.disabled = false;
});
if (params.has("auto")) void run();
