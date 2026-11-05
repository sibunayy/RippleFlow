// Usage: node scripts/run-timeline.mjs "<app url>?debug&noloop"
// Animates a layer with auto-key via the pen, then retimes and deletes keys through the timeline UI.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
const frame = () => page.evaluate(() => window.__rf.frame());
const keys = () => page.evaluate(() => window.__rf.ctrl.document.layers[0].transform.x.keys.map((k) => [+k.t.toFixed(3), +k.value.toFixed(1)]));

await page.getByText("Star", { exact: true }).click();
await page.getByLabel("Auto-key").check();
const pos = () => page.evaluate(() => { const c = window.__rf.ctrl; const m = c.view; const it = c.scene().find((i) => i.id === c.selection); const w = it.matrix; const cx = w[0] * 120 + w[2] * 120 + w[4], cy = w[1] * 120 + w[3] * 120 + w[5]; return [m[0] * cx + m[2] * cy + m[4], m[1] * cx + m[3] * cy + m[5]]; });
const penDrag = async (dx) => {
  const [cx, cy] = await pos();
  const box = await page.locator("canvas").boundingBox();
  const x = box.x + cx, y = box.y + cy;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y);
  await page.mouse.up();
};
for (const [t, dx] of [[0, 0], [2, 120], [4, -60]]) {
  await page.evaluate((t) => window.__rf.ctrl.setTime(t), t);
  if (dx) await penDrag(dx);
}
await frame();
console.log("keys after animating:", JSON.stringify(await keys()));
console.log("diamonds in DOM:", await page.locator(".key").count());

// Drag the middle diamond (t=2) about 1s to the right on the timeline.
const d = await page.locator(".key").nth(0).boundingBox(); // columns are time-sorted: t=2 first? print positions
const all = await page.locator(".key").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
console.log("diamond x positions:", all);
const ruler = await page.locator(".ruler").boundingBox();
const mid = (await page.locator(".key").nth(0).boundingBox());
const pxPerSec = ruler.width / 6;
await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2);
await page.mouse.down();
await page.mouse.move(mid.x + mid.width / 2 + pxPerSec * 1, mid.y + mid.height / 2, { steps: 6 });
await page.mouse.up();
console.log("keys after retime +1s:", JSON.stringify(await keys()));

// Delete the (now picked? no: retime clears pick) - pick and delete the last diamond.
const n = await page.locator(".key").count();
const last = await page.locator(".key").nth(n - 1).boundingBox();
await page.mouse.click(last.x + last.width / 2, last.y + last.height / 2);
await page.getByText("Delete key").click();
console.log("keys after delete:", JSON.stringify(await keys()));

// Scrub via ruler.
await page.mouse.click(ruler.x + pxPerSec * 3, ruler.y + 20);
console.log("time after ruler tap (expect ~3):", await page.evaluate(() => window.__rf.ctrl.time));
await page.evaluate(() => window.__rf.ctrl.undo()); await page.evaluate(() => window.__rf.ctrl.undo());
console.log("keys after 2 undos:", JSON.stringify(await keys()));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
