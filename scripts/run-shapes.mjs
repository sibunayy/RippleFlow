// Usage: node scripts/run-shapes.mjs "<app url>?debug&noloop"
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
const kinds = ["Rounded rect", "Triangle", "Hexagon", "Plus", "Arrow", "Heart", "Line"];
for (const k of kinds) { await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: k, exact: true }).click(); }
const info = await page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => { const g = window.__rf.ctrl.geometryOf(l.id); return [l.name, g?.parts.length ?? 0, g?.bounds ? Math.round(g.bounds.w) : null]; }));
console.log(JSON.stringify(info));
console.log(info.length === kinds.length && info.every((r) => r[1] > 0 && r[2] > 200) ? "PASS" : "FAIL", "all seven shapes add and tessellate");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
