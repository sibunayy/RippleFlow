// Usage: node scripts/run-fx.mjs "<app url>?debug&noloop"
// Pixel checks for layer effects (the compositing path).
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(500);
const SPECS = await page.evaluate(() => null);
// Layer: 200x100 rect centred at (200,150) in a 400x300 comp, backdrop (0.5,0.25,1).
const setDoc = (specs, extra = {}, more = []) => page.evaluate(([specs, extra, more]) => {
  const t = (v) => ({ keys: [{ id: "s" + v, t: 0, value: v }] });
  const e = { keys: [] };
  const mk = (id, x, y, fill, ex = {}, fx = []) => ({ id, name: id, kind: "shape", ...ex,
    effects: fx.length ? fx : undefined,
    shape: { path: "M0 0 H100 V100 H0 Z", fill },
    transform: { anchorX: t(50), anchorY: t(50), x: t(x), y: t(y), scaleX: e, scaleY: e, rotation: e, opacity: ex.__op ? t(ex.__op) : e } });
  const fx = specs.map((s, i) => ({ id: "f" + i, type: s.type, values: Object.fromEntries(Object.entries(s.v).map(([k, v]) => [k, { keys: [{ id: `f${i}.${k}`, t: 0, value: v }] }])), ...(s.color ? { color: s.color } : {}) }));
  const layers = [mk("a", 200, 150, [0.8, 0.2, 0.2, 1], extra, fx), ...more.map((m, i) => mk("m" + i, m.x, m.y, m.fill))];
  window.__rf.ctrl.view = [1, 0, 0, 1, 0, 0];
  window.__rf.ctrl.replaceDocument({ width: 400, height: 300, fps: 30, duration: 1, background: [0.5, 0.25, 1, 1], layers });
}, [specs, extra, more]);
const px = (x, y) => page.evaluate(async ([x, y]) => { window.__rf.frame(); const r = await window.__rf.renderer.readPixels(); const i = (y * r.width + x) * 4; return [...r.data.slice(i, i + 3)]; }, [x, y]);
const show = async (label, pts) => console.log(label, (await Promise.all(pts.map(([x, y]) => px(x, y)))).map((p) => p.join(",")).join("  |  "));
// rect spans x 150..250, y 100..200. Backdrop (128,64,255); rect (204,51,51).
await setDoc([]);
await show("plain  inside/outside:", [[200, 150], [100, 150]]);
await setDoc([{ type: "invert", v: { amount: 1 } }]);
await show("invert inside (expect 51,204,204) / outside (128,64,255):", [[200, 150], [100, 150]]);
await setDoc([{ type: "blur", v: { radius: 20 } }]);
await show("blur centre(~204,51,51) edge(mix) outside-near(slightly mixed) far:", [[200, 150], [150, 150], [140, 150], [60, 150]]);
await setDoc([{ type: "dropShadow", color: [0, 0, 0, 1], v: { opacity: 1, angle: 90, distance: 30, blur: 0 } }]);
await show("shadow below rect (y=215 dark ~0,0,0), right of rect (backdrop), inside unchanged:", [[200, 215], [270, 150], [200, 150]]);
await setDoc([{ type: "glow", color: [1, 1, 0, 1], v: { intensity: 1, blur: 0.05 } }]);
await show("glow tiny blur: outside unchanged / inside:", [[100, 150], [200, 150]]);
await setDoc([{ type: "levels", v: { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 0.5 } }]);
await show("levels outWhite .5 (expect ~102,26,26):", [[200, 150]]);
await setDoc([{ type: "brightnessContrast", v: { brightness: 0.2, contrast: 0 } }]);
await show("brightness +.2 (expect ~255,102,102):", [[200, 150]]);
await setDoc([{ type: "hueSaturation", v: { hue: 0, saturation: -1, lightness: 0 } }]);
await show("desaturate (expect equal channels):", [[200, 150]]);
await setDoc([{ type: "tint", color: [0, 0, 1, 1], v: { amount: 1 } }]);
await show("tint blue:", [[200, 150]]);
await setDoc([{ type: "posterize", v: { levels: 2 } }]);
await show("posterize 2 (each channel 0 or 255):", [[200, 150]]);
await setDoc([{ type: "exposure", v: { stops: -1 } }]);
await show("exposure -1 (expect ~102,25,25):", [[200, 150]]);
await setDoc([{ type: "noise", color: undefined, v: { amount: 0.3, size: 1, mono: 1, speed: 0 } }]);
const samples = await Promise.all([...Array(12)].map((_, i) => px(160 + i * 5, 150)));
console.log("noise varies across pixels:", new Set(samples.map((p) => p.join(","))).size, "distinct of 12; outside untouched:", (await px(100, 150)).join(","));
// Ordering: plain layer above the fx layer must stay crisp and on top; plain layer below must show through blur.
await setDoc([{ type: "blur", v: { radius: 30 } }], {}, [{ x: 200, y: 150, fill: [0, 1, 0, 1] }]);
await show("plain layer above blurred one is crisp green:", [[200, 150], [155, 150]]);
// Opacity + blend with effects.
await setDoc([{ type: "invert", v: { amount: 1 } }], { __op: 0.5 });
await show("invert + 50% opacity (expect mix of 51,204,204 and 128,64,255 = ~90,134,230):", [[200, 150]]);
await setDoc([{ type: "invert", v: { amount: 1 } }], { blend: "multiply" });
await show("invert + multiply (expect 51/255*128=26, 204/255*64=51, 204):", [[200, 150]]);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
