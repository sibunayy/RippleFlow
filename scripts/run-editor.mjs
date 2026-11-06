// Usage: node scripts/run-editor.mjs "<url of the app>?debug&noloop"
// Adds a shape, drags it with a simulated pen, checks pixels by offscreen readback, then pinches the view.
import { launch } from "./lib/browser.mjs";

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf, null, { timeout: 15000 });
const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => page.evaluate(() => window.__rf.frame());

// Pixel at a canvas CSS point, via offscreen readback (canvas screenshots are blank on the software GPU).
const pixel = (x, y) =>
  page.evaluate(async ([x, y]) => {
    const { width, data } = await window.__rf.renderer.readPixels();
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    return [...data.slice(i, i + 4)];
  }, [x, y]);
const state = () => page.evaluate(() => {
  const c = window.__rf.ctrl;
  const l = c.document.layers[0];
  return { layers: c.document.layers.length, sel: c.selection, x: l?.transform.x.keys[0]?.value, y: l?.transform.y.keys[0]?.value, view: c.view.map((v) => +v.toFixed(3)) };
});

await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
await frame();
const s0 = await state();
const box = await page.locator("canvas").boundingBox();
const [cx, cy] = await page.evaluate(() => {
  const c = window.__rf.ctrl; const m = c.view;
  return [m[0] * 960 + m[2] * 540 + m[4], m[1] * 960 + m[3] * 540 + m[5]];
});
console.log("after add:", s0, "centre px", [cx, cy].map(Math.round), "box", box.width, box.height);
console.log("centre pixel (expect red-ish):", await pixel(cx, cy));
console.log("corner pixel (expect transparent: the stage dot grid shows around the composition):", await pixel(5, 5));

// Pen drag 100 css px right.
const px = box.x + cx, py = box.y + cy;
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: px, y: py, button: "left", buttons: 1, clickCount: 1, pointerType: "pen", force: 0.5 });
for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px + i * 10, y: py, button: "left", buttons: 1, pointerType: "pen", force: 0.5 }); await sleep(10); }
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: px + 100, y: py, button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });
await frame();
const s1 = await state();
console.log("after pen drag:", s1);
console.log("moved by comp units:", s1.x - s0.x, "(expect 100 / zoom =", (100 / s1.view[0]).toFixed(1) + ")");
console.log("pixel at old right edge region moved:", await pixel(cx + 100, cy));

// Touch must not edit; two-finger spread zooms.
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: px - 50, y: py + 200, id: 1 }, { x: px + 50, y: py + 200, id: 2 }] });
for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: px - 50 - i * 5, y: py + 200, id: 1 }, { x: px + 50 + i * 5, y: py + 200, id: 2 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await frame();
const s2 = await state();
console.log("after pinch:", s2, "zoom ratio", (s2.view[0] / s1.view[0]).toFixed(2), "x unchanged:", s2.x === s1.x);

await page.evaluate(() => window.__rf.ctrl.undo());
await frame();
console.log("after undo x:", (await state()).x);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
