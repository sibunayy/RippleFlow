// Usage: node scripts/run-props.mjs "<app url>?debug&noloop"
// Edits transform fields numerically, trims a layer on the timeline, and checks it drops out of the scene.
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.getByRole("tab", { name: "Transform" }).click();
const doc = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rf.ctrl.document.layers[0])));

await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Ellipse", exact: true }).click();
await page.getByLabel("Rotation degrees").fill("30"); await page.getByLabel("Rotation degrees").press("Enter");
await page.getByLabel("Opacity percent").fill("50"); await page.getByLabel("Opacity percent").press("Enter");
await page.getByLabel("Scale width percent").fill("200"); await page.getByLabel("Scale width percent").press("Enter");
let l = await doc();
console.log("rotation:", l.transform.rotation.keys[0]?.value, "opacity:", l.transform.opacity.keys[0]?.value, "scaleX:", l.transform.scaleX.keys[0]?.value);
await page.getByLabel("Opacity percent").fill("999"); await page.getByLabel("Opacity percent").press("Enter");
console.log("opacity clamped:", (await doc()).transform.opacity.keys[0]?.value, "box shows:", await page.getByLabel("Opacity percent").inputValue());

// Trim: drag the out handle from t=6 back to t=3.
const ruler = await page.locator(".ruler").boundingBox();
const out = await page.locator(".trim.out").first().boundingBox();
const px = ruler.width / 6;
await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2);
await page.mouse.down();
await page.mouse.move(out.x + out.width / 2 - px * 3, out.y + out.height / 2, { steps: 8 });
await page.mouse.up();
l = await doc();
console.log("outPoint:", l.outPoint?.toFixed(3), "inPoint:", l.inPoint);
for (const t of [2.9, 3.2]) {
  await page.evaluate((t) => window.__rf.ctrl.setTime(t), t);
  console.log(`scene items at ${t}s:`, await page.evaluate(() => window.__rf.ctrl.scene().length));
}
// Trim in-handle past the out point must stop one frame short.
const inn = await page.locator(".trim.in").first().boundingBox();
await page.mouse.move(inn.x + inn.width / 2, inn.y + inn.height / 2);
await page.mouse.down();
await page.mouse.move(inn.x + inn.width / 2 + px * 5, inn.y + inn.height / 2, { steps: 8 });
await page.mouse.up();
l = await doc();
console.log("in past out ->", l.inPoint?.toFixed(3), "out", l.outPoint?.toFixed(3), "(in < out:", l.inPoint < l.outPoint + 1e-9, ")");
// Scrub: drag the Rotate field right by 40 px (0.5 deg/px = +20), one undo step, preview shows live.
const rot = page.getByLabel("Rotation degrees");
const before = await page.evaluate(() => window.__rf.ctrl.document.layers[0].transform.rotation.keys[0].value);
const rb = await page.locator(".scrub", { has: rot }).boundingBox();
await page.mouse.move(rb.x + 20, rb.y + 30); await page.mouse.down();
await page.mouse.move(rb.x + 40, rb.y + 30, { steps: 4 });
await page.mouse.move(rb.x + 60, rb.y + 30, { steps: 4 });
console.log("committed during drag (expect", before, "):", await page.evaluate(() => window.__rf.ctrl.document.layers[0].transform.rotation.keys[0].value), "box:", await rot.inputValue());
await page.mouse.up();
const after = await page.evaluate(() => window.__rf.ctrl.document.layers[0].transform.rotation.keys[0].value);
console.log("rotation", before, "->", after, "(expect +20)");
await page.getByRole("button", { name: "Undo" }).click();
console.log("after one undo:", await page.evaluate(() => window.__rf.ctrl.document.layers[0].transform.rotation.keys[0].value));
// Tap types.
await page.mouse.click(rb.x + 20, rb.y + 30);
console.log("tap focuses input:", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
