// Usage: node scripts/run-stagger.mjs "<app url>?debug&noloop"
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
writeFileSync("/tmp/rf-stagger.svg", `<svg viewBox="0 0 300 100"><rect x="0" y="0" width="80" height="80" fill="#fff"/><rect x="110" y="0" width="80" height="80" fill="#fff"/><rect x="220" y="0" width="80" height="80" fill="#fff"/></svg>`);
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
await page.getByRole("tab", { name: "Transform" }).click();
await page.evaluate(() => { const d = window.__rf.ctrl.document; window.__rf.ctrl.replaceDocument({ ...d, background: [0, 0, 0, 1] }); });
await page.locator('input[accept=".svg,image/svg+xml"]').setInputFiles("/tmp/rf-stagger.svg"); await page.waitForTimeout(500);
await page.getByRole("tab", { name: "Motion" }).click(); await page.getByLabel("Animate in preset").selectOption("fade-in");
const lit = (t) => page.evaluate(async (t) => {
  const { ctrl, renderer } = window.__rf; ctrl.setSelection(null); ctrl.setTime(t); window.__rf.frame();
  const r = await renderer.readPixels(); let n = 0;
  for (let i = 0; i < r.data.length; i += 4) if (r.data[i] > 240 && r.data[i + 1] > 240 && r.data[i + 2] > 240) n++;
  return n;
}, t);
const a = await lit(0.01), b = await lit(0.3), c = await lit(0.7), d = await lit(1.5);
console.log(JSON.stringify([a, b, c, d]));
console.log(a < b && b < c && c <= d && a < d / 4 ? "PASS" : "FAIL", "squares fade in one after another");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
