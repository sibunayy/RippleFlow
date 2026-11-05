// Usage: node scripts/screenshot-spike.mjs <url> <out.png>
// Needs Playwright resolvable via NODE_PATH (it is preinstalled in the cloud container).
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 560, height: 720 }, deviceScaleFactor: 1 });
page.on("console", (m) => console.log("console:", m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__spike && (window.__spike.ready || window.__spike.error), null, { timeout: 30000 });
console.log(JSON.stringify(await page.evaluate(() => window.__spike)));
// Headless software-GPU Chromium cannot screenshot a WebGPU canvas reliably, so save the offscreen readback.
const url64 = await page.evaluate(() => window.__spikePng());
const { writeFileSync } = await import("node:fs");
writeFileSync(out, Buffer.from(url64.split(",")[1], "base64"));
await browser.close();
