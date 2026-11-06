// Usage: node scripts/run-svg.mjs "<app url>?debug&noloop"
import { writeFileSync } from "node:fs";
import { launch } from "./lib/browser.mjs";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/><circle cx="50" cy="50" r="25" fill="#0000ff"/></svg>`;
const gsvg = `<svg viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>`;
writeFileSync("/tmp/rf-grad.svg", gsvg);
const file = "/tmp/rf-test.svg"; writeFileSync(file, svg);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
await page.locator('input[accept=".svg,image/svg+xml"]').setInputFiles(file);
await page.waitForTimeout(500);
console.log(JSON.stringify(await page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => [l.id, l.name, l.parent ?? null, l.shape?.fill ?? null]))));
const bb = await page.evaluate(async () => {
  const { ctrl, renderer } = window.__rf; ctrl.setTime(0); window.__rf.frame();
  const r = await renderer.readPixels(); const box = { r: [1e9, -1], b: [1e9, -1] };
  for (let i = 0; i < r.data.length; i += 4) {
    const x = (i / 4) % r.width, d = r.data;
    const k = d[i] > 250 && d[i + 1] < 5 && d[i + 2] < 5 ? "r" : d[i + 2] > 250 && d[i] < 5 && d[i + 1] < 5 ? "b" : null;
    if (k) { box[k][0] = Math.min(box[k][0], x); box[k][1] = Math.max(box[k][1], x); }
  }
  return box;
});
const wr = bb.r[1] - bb.r[0] + 1, wb = bb.b[1] - bb.b[0] + 1;
console.log(Math.abs(wb / wr - 0.5) < 0.02 ? "PASS" : "FAIL", "circle is half the square's width", wb, wr, "centred:", Math.abs((bb.r[0] + bb.r[1]) / 2 - (bb.b[0] + bb.b[1]) / 2) < 2);
await page.evaluate(() => window.__rf.ctrl.undo());
await page.locator('input[accept=".svg,image/svg+xml"]').setInputFiles("/tmp/rf-grad.svg"); await page.waitForTimeout(500);
const g = await page.evaluate(async () => {
  const { ctrl, renderer } = window.__rf; ctrl.setTime(0); window.__rf.frame();
  const r = await renderer.readPixels(); const row = (r.height >> 1) * r.width;
  const xs = []; for (let x = 0; x < r.width; x++) { const i = (row + x) * 4; if (r.data[i + 1] < 10 && r.data[i] + r.data[i + 2] > 200) xs.push([r.data[i], r.data[i + 2]]); }
  return { grad: ctrl.document.layers.at(-1).shape.gradient?.kind, first: xs[8], last: xs[xs.length - 9] };
});
console.log(g.grad === "linear" && g.first[0] > g.first[1] && g.last[1] > g.last[0] ? "PASS" : "FAIL", "gradient red->blue", JSON.stringify(g));
await page.evaluate(() => window.__rf.ctrl.undo());
console.log("undo layers:", await page.evaluate(() => window.__rf.ctrl.document.layers.length));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
