// Usage: node scripts/run-svg.mjs "<app url>?debug&noloop"
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/><circle cx="50" cy="50" r="25" fill="#0000ff"/></svg>`;
const file = "/tmp/rf-test.svg"; writeFileSync(file, svg);
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
await page.locator('input[accept=".svg,image/svg+xml"]').setInputFiles(file);
await page.waitForTimeout(500);
console.log(JSON.stringify(await page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => [l.id, l.name, l.parent ?? null, l.shape?.fill ?? null]))));
const bb = await page.evaluate(async () => {
  const { ctrl, renderer } = window.__rf; ctrl.setTime(0); window.__rf.frame();
  const r = await renderer.readPixels(); const box = { r: [1e9, -1], b: [1e9, -1] };
  for (let i = 0; i < r.data.length; i += 4) {
    const x = (i / 4) % r.width, d = r.data;
    const k = d[i] > 250 && d[i + 1] < 5 && d[i + 2] < 5 ? "r" : d[i + 2] > 250 && d[i] < 5 && d[i + 1] < 5 ? "b" : null;
    if (k) { box[k][0] = Math.min(box[k][0], x); box[k][1] = Math.max(box[k][1], x); }
  }
  return box;
});
const wr = bb.r[1] - bb.r[0] + 1, wb = bb.b[1] - bb.b[0] + 1;
console.log(Math.abs(wb / wr - 0.5) < 0.02 ? "PASS" : "FAIL", "circle is half the square's width", wb, wr, "centred:", Math.abs((bb.r[0] + bb.r[1]) / 2 - (bb.b[0] + bb.b[1]) / 2) < 2);
await page.evaluate(() => window.__rf.ctrl.undo());
console.log("undo layers:", await page.evaluate(() => window.__rf.ctrl.document.layers.length));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
