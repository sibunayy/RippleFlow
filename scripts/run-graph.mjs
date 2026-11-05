// Usage: node scripts/run-graph.mjs "<app url>?debug&noloop"
// Animates X with auto-key, picks the first diamond, and edits its easing by dragging handles and clicking presets.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
const key0 = () => page.evaluate(() => window.__rf.ctrl.document.layers[0].transform.x.keys[0]);
const xAt = (t) => page.evaluate((t) => { const c = window.__rf.ctrl; c.setTime(t); return c.scene()[0].matrix[4]; }, t);

await page.getByText("Rect", { exact: true }).click();
await page.getByLabel("Auto-key").check();
await page.evaluate(() => window.__rf.ctrl.setTime(2));
await page.getByLabel("X", { exact: true }).fill("1960"); await page.getByLabel("X", { exact: true }).press("Enter");
console.log("graph hidden before pick:", (await page.locator(".graph").count()) === 0);
const linearMid = await xAt(1);
await page.locator(".key").first().click();
console.log("graph shown after pick:", (await page.locator(".graph").count()) === 1);

// Preset: Ease in -> midpoint should lag the linear one.
await page.getByText("Ease in", { exact: true }).first().click();
console.log("ease after preset:", JSON.stringify((await key0()).ease));
const easeInMid = await xAt(1);
console.log(`midpoint linear ${linearMid.toFixed(1)} -> ease-in ${easeInMid.toFixed(1)} (lags: ${easeInMid < linearMid})`);

// Drag handle 1 up-left into overshoot territory.
const h = await page.locator(".g-handle").nth(0).boundingBox();
const svg = await page.locator(".graph svg").boundingBox();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
await page.mouse.down();
await page.mouse.move(svg.x + svg.width * 0.3, svg.y + svg.height * 0.05, { steps: 6 });
await page.mouse.up();
const e = (await key0()).ease;
console.log("ease after drag:", JSON.stringify(e.map((v) => +v.toFixed(2))), "x in [0,1]:", e[0] >= 0 && e[0] <= 1);

// Drag far outside the plot: x clamps, y clamps.
const h2 = await page.locator(".g-handle").nth(1).boundingBox();
await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
await page.mouse.down();
await page.mouse.move(svg.x + svg.width * 1.5, svg.y - 200, { steps: 6 });
await page.mouse.up();
console.log("ease after wild drag:", JSON.stringify((await key0()).ease.map((v) => +v.toFixed(2))));

await page.getByText("Linear", { exact: true }).first().click();
console.log("ease after Linear:", JSON.stringify((await key0()).ease));
await page.evaluate(() => { window.__rf.ctrl.undo(); });
console.log("after undo ease defined:", (await key0()).ease !== undefined);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
