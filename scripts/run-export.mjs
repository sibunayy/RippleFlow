// Usage: node scripts/run-export.mjs "<url with ?auto=1&...>" <out.mp4>
// Runs the export page in headless Chromium (software GPU) and saves the resulting MP4.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
page.on("console", (m) => console.log("console:", m.type(), m.text()));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(url);
await page.waitForFunction(() => window.__export?.done, null, { timeout: 280000, polling: 500 });
console.log(JSON.stringify(await page.evaluate(() => window.__export), null, 1));
const b64 = await page.evaluate(async () => {
  const v = document.querySelector("video");
  if (!v) return null;
  const buf = new Uint8Array(await (await fetch(v.src)).arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});
if (b64) writeFileSync(out, Buffer.from(b64, "base64"));
await browser.close();
