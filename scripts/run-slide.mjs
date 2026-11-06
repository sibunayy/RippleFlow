// Usage: node scripts/run-slide.mjs "<app url>?debug&noloop"
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
await page.evaluate(() => { const c = window.__rf.ctrl; const l = c.document.layers[0]; c.execute({ label: "t", apply: (d) => ({ ...d, layers: [{ ...l, inPoint: 0, outPoint: 2 }] }) }); });
const info = () => page.evaluate(() => { const l = window.__rf.ctrl.document.layers[0]; return [l.inPoint, l.outPoint, l.transform.x.keys.map((k) => +k.t.toFixed(2))]; });
console.log("before:", JSON.stringify(await info()));
const bar = page.locator(".bar-range").first(); const b = await bar.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2, { steps: 5 }); await page.mouse.up();
console.log("after:", JSON.stringify(await info()));
await page.evaluate(() => window.__rf.ctrl.undo());
console.log("undo:", JSON.stringify(await info()));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
