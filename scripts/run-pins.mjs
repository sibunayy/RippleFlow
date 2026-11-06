// Usage: node scripts/run-pins.mjs "<app url>?debug&noloop" <quadrant.png>
// Puppet pins: add, drag (mesh deforms: pixels move), keyframe with auto-key, delete, undo, persistence round trip.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [url, img] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(500);
const check = (n, ok, extra = "") => console.log(ok ? "PASS" : "FAIL", n, extra);
await page.setInputFiles('input[accept="image/*"]', img);
await page.waitForFunction(() => window.__rf.ctrl.document.layers.length === 1);
// Layer-local (picture pixel) point -> canvas pixel -> pixel colour on screen.
const toScreen = (lx, ly) => page.evaluate(([lx, ly]) => { const { ctrl } = window.__rf; const m = ctrl.scene()[0].matrix; const v = ctrl.view;
  const cx = m[0] * lx + m[2] * ly + m[4], cy = m[1] * lx + m[3] * ly + m[5]; return [v[0] * cx + v[2] * cy + v[4], v[1] * cx + v[3] * cy + v[5]]; }, [lx, ly]);
const colourAt = (lx, ly) => page.evaluate(async ([lx, ly]) => { const { ctrl, renderer } = window.__rf; ctrl.setTime(ctrl.time); window.__rf.frame();
  const m = ctrl.scene()[0].matrix, v = ctrl.view;
  const cx = m[0] * lx + m[2] * ly + m[4], cy = m[1] * lx + m[3] * ly + m[5];
  const x = Math.round(v[0] * cx + v[2] * cy + v[4]), y = Math.round(v[1] * cx + v[3] * cy + v[5]);
  const r = await renderer.readPixels(); const i = (y * r.width + x) * 4; return [...r.data.slice(i, i + 3)]; }, [lx, ly]);
const red = (c) => c[0] > 200 && c[1] < 60 && c[2] < 60;
const green = (c) => c[1] > 200 && c[0] < 60 && c[2] < 60;
const pointer = (kind, x, y) => page.evaluate(([kind, x, y]) => window.__rf.ctrl["pointer" + kind]({ id: 1, type: "pen", x, y }), [kind, x, y]);
const layerImage = () => page.evaluate(() => window.__rf.ctrl.document.layers[0].image);

check("starts undeformed (red at 100,100; green at 300,100)", red(await colourAt(100, 100)) && green(await colourAt(300, 100)));
await page.getByRole("button", { name: "Pin warp" }).click();
const [sx, sy] = await toScreen(100, 100);
await pointer("Down", sx, sy); await pointer("Up", sx, sy);
let im = await layerImage();
check("tap adds a pin", im.pins?.length === 1, JSON.stringify(im.pins?.[0] && { x: Math.round(im.pins[0].x), y: Math.round(im.pins[0].y) }));
// Drag the pin 150 picture pixels to the right.
const [ex] = await toScreen(250, 100);
await pointer("Down", sx, sy); await pointer("Move", (sx + ex) / 2, sy); await pointer("Move", ex, sy); await pointer("Up", ex, sy);
im = await layerImage();
check("drag sets the pin's pull", Math.abs(im.pins[0].dx.keys[0].value - 150) < 3, `dx=${im.pins[0].dx.keys[0]?.value}`);
check("red was pulled over the green area", red(await colourAt(250, 100)));
check("far corner untouched", await colourAt(390, 390).then((c) => c[0] > 200 && c[1] > 200 && c[2] < 60));
await page.getByRole("button", { name: "Undo" }).click();
im = await layerImage();
check("undo returns the pin to no pull", (im.pins[0].dx.keys[0]?.value ?? 0) === 0 || im.pins[0].dx.keys.length === 0);
await page.getByRole("button", { name: "Redo" }).click();
// Keyframes: auto-key at 1s pulls further; at 0s the pull stays.
await page.evaluate(() => { window.__rf.ctrl.autoKey = true; window.__rf.ctrl.setTime(1); });
const [s2x, s2y] = await page.evaluate(() => 0).then(() => toScreen(250, 100));
await pointer("Down", s2x, s2y); await pointer("Move", s2x, s2y + 40); await pointer("Up", s2x, s2y + 40);
im = await layerImage();
check("auto-key writes keys", im.pins[0].dy.keys.length >= 2, `dy keys=${im.pins[0].dy.keys.length}`);
const rt = await page.evaluate(async () => { const { serialize, deserialize } = await import("/src/persist/serialize.ts"); const d = window.__rf.ctrl.document;
  return JSON.stringify(deserialize(serialize(d)).layers[0].image.pins) === JSON.stringify(d.layers[0].image.pins); });
check("serialize round trip", rt);
await page.getByRole("button", { name: "Delete pin" }).click();
check("delete removes the pin and the warp", (await layerImage()).pins === undefined);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
