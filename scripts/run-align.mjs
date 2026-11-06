// Usage: node scripts/run-align.mjs "<app url>?debug&noloop"
import { writeFileSync } from "node:fs";
import { launch } from "./lib/browser.mjs";
writeFileSync("/tmp/rf-align.svg", `<svg viewBox="0 0 100 100"><rect width="40" height="40" fill="#f00"/><rect x="60" y="60" width="40" height="40" fill="#00f"/></svg>`);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
await page.getByRole("tab", { name: "Transform" }).click();
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
const pos = () => page.evaluate(() => { const l = window.__rf.ctrl.document.layers.at(-1); return [l.transform.x.keys.at(-1).value, l.transform.y.keys.at(-1).value]; });
await page.getByLabel("Align to composition").selectOption("left");
const a = await pos();
await page.getByLabel("Align to composition").selectOption("bottom");
const b = await pos();
console.log(a[0] < 200 && b[1] > 800 ? "PASS" : "FAIL", "rect aligned left then bottom", JSON.stringify(a), JSON.stringify(b));
await page.evaluate(() => { window.__rf.ctrl.undo(); window.__rf.ctrl.undo(); });
// SVG group: its children's union box should be centred after "centre"
await page.evaluate(() => window.__rf.ctrl.undo());
await page.locator('input[accept=".svg,image/svg+xml"]').setInputFiles("/tmp/rf-align.svg"); await page.waitForTimeout(500);
await page.getByLabel("Align to composition").selectOption("left");
const edge = await page.evaluate(async () => {
  const { ctrl, renderer } = window.__rf; ctrl.setSelection(null); window.__rf.frame();
  const r = await renderer.readPixels(); let white = 1e9, red = 1e9;
  for (let i = 0; i < r.data.length; i += 4) {
    const x = (i / 4) % r.width, d = r.data;
    if (d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250) white = Math.min(white, x);
    if (d[i] > 250 && d[i + 1] < 5 && d[i + 2] < 5) red = Math.min(red, x);
  }
  return { white, red };
});
console.log(Math.abs(edge.white - edge.red) <= 1 ? "PASS" : "FAIL", "svg group's left edge sits on the composition's left edge", JSON.stringify(edge));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
