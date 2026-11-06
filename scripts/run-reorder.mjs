// Usage: node scripts/run-reorder.mjs "<app url>?debug&noloop"
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
for (const n of ["Rect", "Ellipse"]) { await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: n, exact: true }).click(); }
const order = () => page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => l.id));
console.log("before:", JSON.stringify(await order()));
const grips = page.locator(".grip"); const n = await grips.count();
const a = await grips.first().boundingBox(); const z = await grips.nth(n - 1).boundingBox();
await page.mouse.move(a.x + 10, a.y + 10); await page.mouse.down();
await page.mouse.move(z.x + 10, z.y + 10, { steps: 5 }); await page.mouse.up();
console.log("after:", JSON.stringify(await order()));
await page.evaluate(() => window.__rf.ctrl.undo());
console.log("undo:", JSON.stringify(await order()));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
