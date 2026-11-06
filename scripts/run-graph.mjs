// Usage: node scripts/run-graph.mjs "<app url>?debug&noloop"
// Animates X with auto-key, opens the Curves view, picks the first key, and edits its easing by dragging handles and the Easing menu.
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

await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
await page.getByRole("button", { name: "Auto-key off" }).click();
await page.evaluate(() => window.__rf.ctrl.setTime(2));
await page.getByLabel("Position X").fill("1960"); await page.getByLabel("Position X").press("Enter");
const linearMid = await xAt(1);
await page.getByRole("button", { name: "Curves" }).click();
console.log("easing menu disabled before pick:", await page.getByLabel("Easing", { exact: true }).isDisabled());
console.log("no handles before pick:", (await page.locator(".g-handle").count()) === 0);
await page.locator(".cv-key").first().dispatchEvent("pointerdown");
console.log("handles shown after pick:", (await page.locator(".g-handle").count()) === 2);

// Preset: Ease in -> midpoint should lag the linear one.
await page.getByLabel("Easing", { exact: true }).selectOption("Ease in");
console.log("ease after preset:", JSON.stringify((await key0()).ease));
const easeInMid = await xAt(1);
console.log(`midpoint linear ${linearMid.toFixed(1)} -> ease-in ${easeInMid.toFixed(1)} (lags: ${easeInMid < linearMid})`);

// Drag handle 1 up-left into overshoot territory.
const h = await page.locator(".g-handle").nth(0).boundingBox();
const svg = await page.locator(".cv-svg").boundingBox();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
await page.mouse.down();
await page.mouse.move(h.x + 40, svg.y + 4, { steps: 6 });
await page.mouse.up();
const e = (await key0()).ease;
console.log("ease after drag:", JSON.stringify(e.map((v) => +v.toFixed(2))), "x in [0,1]:", e[0] >= 0 && e[0] <= 1);

// Drag far outside the plot: x clamps, y clamps.
const h2 = await page.locator(".g-handle").nth(1).boundingBox();
await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
await page.mouse.down();
await page.mouse.move(svg.x + svg.width + 300, svg.y - 400, { steps: 6 });
await page.mouse.up();
console.log("ease after wild drag:", JSON.stringify((await key0()).ease.map((v) => +v.toFixed(2))));

await page.getByLabel("Easing", { exact: true }).selectOption("Linear");
console.log("ease after Linear:", JSON.stringify((await key0()).ease));
await page.evaluate(() => { window.__rf.ctrl.undo(); });
console.log("after undo ease defined:", (await key0()).ease !== undefined);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
