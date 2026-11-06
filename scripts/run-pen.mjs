// Usage: node scripts/run-pen.mjs "<app url>?debug&noloop"
// Pen tool through the real UI: draw a closed shape, an open stroke, a curve by dragging, and a mask on a layer.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(600);
const layers = () => page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => ({ id: l.id, name: l.name, path: l.shape?.path, fill: !!l.shape?.fill, stroke: !!l.shape?.stroke, masks: (l.masks ?? []).length })));
const box = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left, y: r.top }; });
const tap = async (x, y) => { await page.mouse.click(box.x + x, box.y + y); };
const before = (await layers()).length;
const check = (name, ok) => console.log(ok ? "PASS" : "FAIL", name);

// Shapes are drawn in the upper part of the stage: the pen bar sits at its bottom.
// Closed triangle: three taps, then tap the first point.
await page.getByRole("button", { name: "Pen", exact: true }).click();
await tap(300, 100); await tap(500, 100); await tap(400, 250);
check("pen points = 3", (await page.evaluate(() => window.__rf.ctrl.penPoints)) === 3);
await tap(302, 102);
let ls = await layers();
check("closed shape added with fill", ls.length === before + 1 && ls.at(-1).fill && !ls.at(-1).stroke && /Z/.test(ls.at(-1).path));
check("pen off after finishing", (await page.evaluate(() => window.__rf.ctrl.penTarget)) === null);

// Open stroke with a dragged curve, finished with Done.
await page.getByRole("button", { name: "Pen", exact: true }).click();
await tap(300, 300);
await page.mouse.move(box.x + 500, box.y + 300); await page.mouse.down();
await page.mouse.move(box.x + 560, box.y + 240, { steps: 4 }); await page.mouse.up();
await tap(700, 320);
await page.getByRole("button", { name: "Done" }).click();
ls = await layers();
check("open stroke layer with a curve", ls.length === before + 2 && ls.at(-1).stroke && !ls.at(-1).fill && ls.at(-1).path.includes("C"));
await page.getByRole("button", { name: "Undo" }).click();
check("undo removes it", (await layers()).length === before + 1);

// Mask on the triangle layer.
const target = (await layers()).at(-1).id;
await page.evaluate((id) => window.__rf.ctrl.setSelection(id), target);
await page.evaluate((id) => window.__rf.ctrl.startPen({ kind: "mask", layerId: id }), target);
await tap(300, 100); await tap(400, 100); await tap(400, 200);
await page.getByRole("button", { name: "Close" }).click();
ls = await layers();
check("mask added to layer", ls.at(-1).masks === 1);
const mk = await page.evaluate((id) => {
  const { ctrl } = window.__rf;
  const l = ctrl.document.layers.find((x) => x.id === id);
  return { path: l.masks[0].path, tr: l.transform };
}, target);
const nums = mk.path.match(/-?\d+(\.\d+)?/g).map(Number);
// Mask is layer-local: first mask point = comp point minus the layer's top-left (anchor-centred layer).
const [ax, ay, px, py] = [mk.tr.anchorX.keys[0].value, mk.tr.anchorY.keys[0].value, mk.tr.x.keys[0].value, mk.tr.y.keys[0].value];
const expect = await page.evaluate(([x, y]) => window.__rf.ctrl.screenToComp(x, y), [300, 100]);
check("mask point is layer-local", Math.abs(nums[0] - (expect[0] - (px - ax))) < 1.5 && Math.abs(nums[1] - (expect[1] - (py - ay))) < 1.5);
check("pen off after mask", (await page.evaluate(() => window.__rf.ctrl.penTarget)) === null);

// Cancel leaves nothing behind.
await page.getByRole("button", { name: "Pen", exact: true }).click();
await tap(200, 200); await tap(260, 200);
await page.getByRole("button", { name: "Cancel" }).click();
check("cancel adds nothing", (await layers()).length === ls.length);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
