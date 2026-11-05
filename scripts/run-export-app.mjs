// Usage: node scripts/run-export-app.mjs "<app url>?debug&noloop" <out.mp4>
// Loads a known composition, exports it through the Export dialog, and saves the MP4 for external checks (ffprobe/ffmpeg).
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__rf);

const empty = { keys: [] };
const doc = {
  background: [0.1, 0.2, 0.6, 1], width: 1920, height: 1080, fps: 30, duration: 1,
  layers: [{
    id: "layer-1", name: "Square", kind: "shape",
    shape: { path: "M0 0 H200 V200 H0 Z", fill: [1, 0, 0, 1] },
    transform: {
      anchorX: { keys: [{ id: "ax", t: 0, value: 100 }] }, anchorY: { keys: [{ id: "ay", t: 0, value: 100 }] },
      x: { keys: [{ id: "x0", t: 0, value: 300 }, { id: "x1", t: 1, value: 1500 }] },
      y: { keys: [{ id: "y0", t: 0, value: 540 }] },
      scaleX: empty, scaleY: empty, rotation: empty, opacity: empty,
    },
  }],
};
await page.evaluate((d) => window.__rf.ctrl.replaceDocument(d), doc);
await page.getByText("Export", { exact: true }).first().click();
console.log("dialog text:", (await page.locator(".sheet p").first().innerText()).replace(/\s+/g, " "));
await page.getByText("720p · 30 fps").click();
console.log("after choosing 720p30:", (await page.locator(".sheet p").first().innerText()).replace(/\s+/g, " "));
await page.locator(".sheet .primary").click();
await page.waitForSelector(".sheet video", { timeout: 120000 });
console.log("result:", (await page.locator(".sheet p").first().innerText()).replace(/\s+/g, " "));
const b64 = await page.evaluate(async () => {
  const buf = new Uint8Array(await (await fetch(document.querySelector(".sheet video").src)).arrayBuffer());
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
writeFileSync(out, Buffer.from(b64, "base64"));
console.log("saved", out, "errors:", errors.length ? errors : "none");
await browser.close();
