import { MeshRenderer } from "../render/meshRenderer";
import { buildLogo } from "./logo";

declare global {
  interface Window {
    __spikePng?: () => Promise<string>;
    __spike?: { ready: boolean; error?: string; tessellateMs?: number; opaquePixels?: number; centerPixel?: number[]; triangles?: number; vertices?: number };
  }
}

async function main() {
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  const stats = document.getElementById("stats")!;
  window.__spike = { ready: false };
  try {
    const renderer = await MeshRenderer.create(canvas);
    const t0 = performance.now();
    const draws = buildLogo(canvas.width / 512);
    const ms = performance.now() - t0;
    renderer.setScene(draws);
    // Render every frame: a WebGPU canvas is only composited after the browser presents it.
    const px = await renderer.readPixels();
    let opaque = 0;
    for (let i = 3; i < px.data.length; i += 4) if (px.data[i]! > 0) opaque++;
    const mid = (512 * px.width + 512) * 4;
    // PNG data URL of the offscreen render (un-premultiplied), for screenshots and golden tests.
    window.__spikePng = async () => {
      const r = await renderer.readPixels();
      const img = new ImageData(r.width, r.height);
      for (let i = 0; i < r.data.length; i += 4) {
        const a = r.data[i + 3]!;
        for (let k = 0; k < 3; k++) img.data[i + k] = a ? Math.min(255, Math.round((r.data[i + k]! * 255) / a)) : 0;
        img.data[i + 3] = a;
      }
      const c2 = document.createElement("canvas");
      c2.width = r.width;
      c2.height = r.height;
      c2.getContext("2d")!.putImageData(img, 0, 0);
      return c2.toDataURL("image/png");
    };
    const frame = () => {
      renderer.render();
      requestAnimationFrame(frame);
    };
    if (!new URLSearchParams(location.search).has("noloop")) requestAnimationFrame(frame);
    const triangles = draws.reduce((n, d) => n + d.mesh.indices.length / 3, 0);
    const vertices = draws.reduce((n, d) => n + d.mesh.positions.length / 2, 0);
    window.__spike = { ready: true, tessellateMs: ms, triangles, vertices, opaquePixels: opaque, centerPixel: Array.from(px.data.slice(mid, mid + 4)) };
    stats.textContent = `Tessellation: ${ms.toFixed(2)} ms\nTriangles: ${triangles}\nVertices: ${vertices}`;
  } catch (e) {
    const error = String(e);
    window.__spike = { ready: false, error };
    stats.textContent = `Error: ${error}`;
  }
}

void main();
