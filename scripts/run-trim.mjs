// Usage: node scripts/run-trim.mjs "<app url>?debug&noloop"
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300);
const check = (n, ok, extra = "") => console.log(ok ? "PASS" : "FAIL", n, extra);
// A white stroked line on black; trim end animates 0 -> 1 over 1s via the real Style panel + auto-key.
await page.evaluate(() => {
  const { ctrl } = window.__rf; const d = ctrl.document;
  const still = (v) => ({ keys: [{ id: "s" + v, t: 0, value: v }] });
  ctrl.replaceDocument({ ...d, background: [0, 0, 0, 1], layers: [{ id: "layer-1", name: "Line", kind: "shape", shape: { path: "M0 0 H800", stroke: { color: [1, 1, 1, 1], width: 40 } },
    transform: { anchorX: still(400), anchorY: still(0), x: still(d.width / 2), y: still(d.height / 2), scaleX: { keys: [] }, scaleY: { keys: [] }, rotation: { keys: [] }, opacity: { keys: [] } } }] });
  ctrl.setSelection("layer-1");
});
await page.evaluate(() => { const c = window.__rf.ctrl; c.autoKey = true; });
const set = (t, v) => page.evaluate(([t, v]) => { const { ctrl } = window.__rf; ctrl.setTime(t); return v; }, [t, v]);
// Use the commands through the panel's controller path: set values with auto-key at t=0 and t=1.
await page.evaluate(async () => {
  const { ctrl } = window.__rf; const m = await import("/src/editor/trimEdit.ts");
  ctrl.setTime(0); ctrl.execute(m.setTrim("layer-1", "end", 0, 0, true));
  ctrl.setTime(1); ctrl.execute(m.setTrim("layer-1", "end", 1, 1, true));
});
const lit = (t) => page.evaluate(async (t) => {
  const { ctrl, renderer } = window.__rf; ctrl.setSelection(null); ctrl.setTime(t); window.__rf.frame();
  const r = await renderer.readPixels(); let n = 0, minX = 1e9, maxX = -1;
  for (let i = 0; i < r.data.length; i += 4) if (r.data[i] > 245 && r.data[i + 1] > 245 && r.data[i + 2] > 245) { n++; const x = (i / 4) % r.width; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  return { n, minX, maxX };
}, t);
const a = await lit(0.02), b = await lit(0.5), c = await lit(1);
console.log(JSON.stringify({ a, b, c }));
check("nothing at start, half at 0.5s, full at 1s", a.n < b.n && b.n < c.n && Math.abs(b.n / c.n - 0.5) < 0.08, `ratio ${(b.n / c.n).toFixed(2)}`);
check("draws on from the left end", Math.abs(b.minX - c.minX) <= 1 && b.maxX < c.maxX);
// the panel exposes the fields
await page.evaluate(() => window.__rf.ctrl.setSelection("layer-1")); await page.waitForTimeout(200);
await page.getByRole("tab", { name: "Style" }).click();
const fields = await page.getByLabel("Trim end %").count();
check("Style panel has trim fields", fields > 0);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
