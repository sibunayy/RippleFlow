// Usage: node scripts/run-style.mjs "<app url>?debug&noloop"
// Reads rendered pixels for blend modes and gradients.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(500);
// Build the scene by replacing the document: a mid-grey-ish backdrop, one rect.
const px = (x, y) => page.evaluate(async ([x, y]) => {
  window.__rf.frame();
  const r = await window.__rf.renderer.readPixels();
  const i = (Math.round(y) * r.width + Math.round(x)) * 4;
  return [...r.data.slice(i, i + 3)];
}, [x, y]);
const setDoc = (layerExtra, shapeExtra) => page.evaluate(([le, se]) => {
  const t = (v) => ({ keys: [{ id: "s", t: 0, value: v }] });
  const e = { keys: [] };
  const layer = { id: "layer-1", name: "r", kind: "shape", ...le,
    shape: { path: "M0 0 H200 V100 H0 Z", fill: [0.5, 0.5, 0.5, 1], ...se },
    transform: { anchorX: e, anchorY: e, x: t(100), y: t(100), scaleX: e, scaleY: e, rotation: e, opacity: e } };
  window.__rf.ctrl.view = [1, 0, 0, 1, 0, 0];
  window.__rf.ctrl.replaceDocument({ width: 400, height: 300, fps: 30, duration: 1, background: [0.5, 0.25, 1, 1], layers: [layer] });
}, [layerExtra, shapeExtra]);
const at = async (x, y) => (await px(x * 1, y * 1)).join(",");
await setDoc({}, {});
console.log("normal over (128,64,255):", await at(200, 150), "(expect 128,128,128)");
await setDoc({ blend: "multiply" }, {});
console.log("multiply grey .5:", await at(200, 150), "(expect ~64,32,128)");
await setDoc({ blend: "screen" }, {});
console.log("screen grey .5:", await at(200, 150), "(expect ~192,160,255)");
await setDoc({ blend: "add" }, {});
console.log("add grey .5:", await at(200, 150), "(expect 255,192,255)");
await setDoc({}, { gradient: { kind: "linear", angle: 0, stops: [{ offset: 0, color: [1, 0, 0, 1] }, { offset: 1, color: [0, 0, 1, 1] }] } });
console.log("linear red->blue left/mid/right:", await at(102, 150), await at(200, 150), await at(298, 150), "(expect ~255,0,0 / 128,0,128 / 0,0,255)");
await setDoc({}, { gradient: { kind: "linear", angle: 90, stops: [{ offset: 0, color: [0, 1, 0, 1] }, { offset: 0.5, color: [1, 1, 0, 1] }, { offset: 1, color: [1, 0, 0, 1] }] } });
console.log("vertical 3 stops top/mid/bottom:", await at(200, 102), await at(200, 150), await at(200, 198), "(expect green / yellow / red)");
await setDoc({}, { gradient: { kind: "radial", angle: 0, stops: [{ offset: 0, color: [1, 1, 1, 1] }, { offset: 1, color: [0, 0, 0, 1] }] } });
console.log("radial centre/edge-mid/corner:", await at(200, 150), await at(298, 150), await at(102, 102), "(expect white / dim / ~black)");
await setDoc({ opacity: undefined }, { gradient: { kind: "linear", angle: 0, stops: [{ offset: 0, color: [1, 0, 0, 0] }, { offset: 1, color: [1, 0, 0, 1] }] } });
console.log("alpha ramp over (128,64,255) left/right:", await at(102, 150), await at(298, 150), "(expect ~backdrop / red)");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
