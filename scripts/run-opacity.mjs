// Usage: node scripts/run-opacity.mjs "<app url>?debug&noloop&videoMode=bitmap" <quad.png> <coded.mp4>
// Checks rendered pixels: opacity (static and animated) for shape, image and video layers, over the white backdrop.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [url, img, clip] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__rf);
const px = (cx, cy) => page.evaluate(async ([cx, cy]) => {
  window.__rf.frame();
  const { ctrl, renderer } = window.__rf; const m = ctrl.view;
  const x = Math.round(m[0] * cx + m[2] * cy + m[4]), y = Math.round(m[1] * cx + m[3] * cy + m[5]);
  const { width, data } = await renderer.readPixels(); const i = (y * width + x) * 4;
  return [...data.slice(i, i + 3)];
}, [cx, cy]);
const field = async (label, v) => { const f = page.getByLabel(label, { exact: true }); await f.fill(String(v)); await f.press("Enter"); };
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const report = (name, got, want) => console.log(`${name}: ${JSON.stringify(got)} want ~${JSON.stringify(want)} ${near(got, want) ? "OK" : "WRONG"}`);

// 1. Shape (layer-1 is orange 250,184,51), static opacity 50%.
await page.getByText("Rect", { exact: true }).click();
report("shape 100%", await px(960, 540), [250, 184, 51]);
await field("Opacity %", 50);
report("shape 50% static", await px(960, 540), [252, 219, 153]);
// 2. Animated opacity with auto-key: 100% at t=0, 20% at t=2 -> 60% at t=1.
await field("Opacity %", 100);
await page.getByLabel("Auto-key").check();
await page.evaluate(() => window.__rf.ctrl.setTime(2));
await field("Opacity %", 20);
for (const [t, a] of [[0, 1], [1, 0.6], [2, 0.2]]) {
  await page.evaluate((t) => window.__rf.ctrl.setTime(t), t);
  report(`shape animated t=${t} (opacity ${a})`, await px(960, 540), [255 - a * 5, 255 - a * 71, 255 - a * 204]);
}
await page.getByLabel("Auto-key").uncheck();
await page.evaluate(() => window.__rf.ctrl.setTime(0));

// 3. Image: red quadrant at 50% over white.
await page.setInputFiles('input[accept="image/*"]', img);
await page.waitForFunction(() => window.__rf.ctrl.document.layers.length === 2);
await page.waitForTimeout(300);
report("image 100% (red TL quadrant)", await px(744, 378), [255, 0, 0]);
await field("Opacity %", 50);
report("image 50% (red over white)", await px(744, 378), [255, 128, 128]);

// 4. Video (bitmap mode): bit 0 square is black, at 50% -> mid grey.
await page.evaluate(() => { const c = window.__rf.ctrl; c.replaceDocument({ ...c.document, layers: [] }); });
await page.setInputFiles('input[accept^="video"]', clip);
await page.waitForFunction(() => window.__rf.ctrl.document.layers.length === 1, null, { timeout: 30000 });
for (let i = 0; i < 60; i++) { await page.evaluate(() => window.__rf.frame()); const v = await px(48, 48); if (v[0] < 40) break; await page.waitForTimeout(40); }
report("video 100% (black bit square)", await px(48, 48), [0, 0, 0]);
await field("Opacity %", 50);
report("video 50% (black over white)", await px(48, 48), [128, 128, 128]);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
