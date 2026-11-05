// Usage: node scripts/run-input.mjs "<url of input.html>"
// Simulates a pen stroke, a palm touch and a two-finger pinch through CDP, then prints the page's results.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(process.argv[2]);
const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pen stroke, pressure 0.1 -> 0.9, tilt sweeping.
await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 200, y: 300, button: "left", buttons: 1, clickCount: 1, pointerType: "pen", force: 0.1, tiltX: 0, tiltY: 0 });
for (let i = 1; i <= 40; i++) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 200 + i * 12, y: 300 + Math.sin(i / 5) * 60, button: "left", buttons: 1, pointerType: "pen", force: 0.1 + (0.8 * i) / 40, tiltX: -30 + i * 1.5, tiltY: 10 + i, twist: i });
  await sleep(8);
}
// A palm lands while the pen is still down.
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 900, y: 600, id: 7, radiusX: 40, radiusY: 40 }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 680, y: 340, button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });

// Two-finger pinch: spread from 100 px apart to 200 px apart, then rotate a bit.
const cx = 590, cy = 410;
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 50, y: cy, id: 1 }, { x: cx + 50, y: cy, id: 2 }] });
for (let i = 1; i <= 20; i++) {
  const half = 50 + (50 * i) / 20;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - half, y: cy, id: 1 }, { x: cx + half, y: cy, id: 2 }] });
  await sleep(8);
}
for (let i = 1; i <= 20; i++) {
  const a = (Math.PI / 2) * (i / 20); // quarter turn
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 100 * Math.cos(a), y: cy - 100 * Math.sin(a), id: 1 }, { x: cx + 100 * Math.cos(a), y: cy + 100 * Math.sin(a), id: 2 }] });
  await sleep(8);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(100);
console.log(JSON.stringify(await page.evaluate(() => window.__input.results()), null, 1));
await browser.close();
