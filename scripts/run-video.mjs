// Usage: node scripts/run-video.mjs "<url with ?auto=1>"            (bundled coded clip)
//        node scripts/run-video.mjs "<url without auto>" <clip.mp4>   (your own clip)
// Runs the video spike in headless Chromium (software GPU) and prints its result JSON.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
page.on("console", (m) => { if (m.type() !== "log") console.log("console:", m.type(), m.text()); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(process.argv[2]);
const clipFile = process.argv[3];
if (clipFile) {
  // Pick a clip through the file input, then press Run (the URL must not have ?auto=1).
  await page.setInputFiles("#file", clipFile);
  await page.click("#run");
}
await page.waitForFunction(() => window.__video?.done, null, { timeout: 240000, polling: 500 });
console.log(JSON.stringify(await page.evaluate(() => window.__video), null, 1));
await browser.close();
