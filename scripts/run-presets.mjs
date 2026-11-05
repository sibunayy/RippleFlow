// Usage: node scripts/run-presets.mjs "<app url>?debug&noloop"
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
await page.getByRole("button", { name: "Rect", exact: true }).click();
const op = (t) => page.evaluate((t) => { const c = window.__rf.ctrl; const k = c.document.layers[0].transform.opacity.keys; return k.length; }, t);
await page.getByRole("button", { name: "Pop in", exact: true }).click();
await page.getByRole("button", { name: "Fade out", exact: true }).click();
const keys = await page.evaluate(() => window.__rf.ctrl.document.layers[0].transform.scaleX.keys.map((k) => [+k.t.toFixed(2), +k.value.toFixed(2)]));
console.log("scaleX keys:", JSON.stringify(keys), "opacity keys:", await op());
// Pixels: at t=0 the rect is invisible (scale 0), mid-span visible, then fully shown.
const lit = (t) => page.evaluate(async (t) => {
  const { ctrl, renderer } = window.__rf; ctrl.setTime(t); window.__rf.frame();
  const r = await renderer.readPixels(); let n = 0;
  for (let i = 0; i < r.data.length; i += 4) if (!(r.data[i] > 245 && r.data[i + 1] > 245 && r.data[i + 2] > 245) && !(r.data[i] === 33 && r.data[i + 1] === 33)) n++;
  return n;
}, t);
const a = await lit(0), b = await lit(1), c = await lit(ctrlEnd());
function ctrlEnd() { return 1.5; }
console.log(a < b ? "PASS" : "FAIL", "invisible at 0, visible at 1s", a, b, c);
await page.evaluate(() => { window.__rf.ctrl.undo(); window.__rf.ctrl.undo(); });
console.log("after undo keys:", await page.evaluate(() => window.__rf.ctrl.document.layers[0].transform.scaleX.keys.length));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
