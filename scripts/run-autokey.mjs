// Usage: node scripts/run-autokey.mjs "<app url>?debug&noloop"
// Reproduces auto-key and opacity behaviour through the real UI.
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.getByRole("tab", { name: "Transform" }).click();
const val = (prop, t) => page.evaluate(([prop, t]) => {
  const l = window.__rf.ctrl.document.layers[0]; const k = l.transform[prop].keys;
  // evaluate like the engine: scene opacity for opacity, matrix for the rest is overkill; read the track directly
  if (!k.length) return null;
  if (t <= k[0].t) return k[0].value; if (t >= k[k.length - 1].t) return k[k.length - 1].value;
  let i = 0; while (k[i + 1].t <= t) i++; const a = k[i], b = k[i + 1]; return a.value + (b.value - a.value) * ((t - a.t) / (b.t - a.t));
}, [prop, t]);
const keys = (prop) => page.evaluate((prop) => window.__rf.ctrl.document.layers[0].transform[prop].keys.map((k) => [+k.t.toFixed(2), +k.value.toFixed(3)]), prop);
const setField = async (label, v) => { const f = page.getByLabel(label, { exact: true }); await f.fill(String(v)); await f.press("Enter"); };

await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
await page.getByRole("button", { name: "Auto-key off" }).click();
await page.evaluate(() => window.__rf.ctrl.setTime(2));
for (const [label, prop, v] of [["Rotation degrees", "rotation", 90], ["Opacity percent", "opacity", 20], ["Scale width percent", "scaleX", 200], ["Position X", "x", 1500]]) {
  await setField(label, v);
  console.log(`${prop}: keys after editing at t=2 ->`, JSON.stringify(await keys(prop)), "| value at t=0:", (await val(prop, 0))?.toFixed(3), " t=1:", (await val(prop, 1))?.toFixed(3), " t=2:", (await val(prop, 2))?.toFixed(3));
}
console.log("diamonds shown in timeline:", await page.locator(".key").count());
console.log("errors:", errors.length ? errors : "none");
await browser.close();
