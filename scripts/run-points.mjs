// Usage: node scripts/run-points.mjs "<app url>?debug&noloop"
// Point editing through the real UI: select a point, drag it, add a point, smooth, delete, undo, pixels.
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
const path = () => page.evaluate(() => window.__rf.ctrl.document.layers[0].shape.path);
const ov = () => page.evaluate(() => { const o = window.__rf.ctrl.nodeOverlay(); const r = document.querySelector("canvas").getBoundingClientRect(); return o && { ...o, ox: r.left, oy: r.top }; });
const drag = async (from, to) => {
  const o = await ov();
  await page.mouse.move(o.ox + from[0], o.oy + from[1]); await page.mouse.down();
  await page.mouse.move(o.ox + (from[0] + to[0]) / 2, o.oy + (from[1] + to[1]) / 2, { steps: 3 });
  await page.mouse.move(o.ox + to[0], o.oy + to[1], { steps: 3 });
  await page.mouse.up();
};
const tap = async (p) => { const o = await ov(); await page.mouse.click(o.ox + p[0], o.oy + p[1]); };

await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
console.log("Edit points offered:", await page.getByRole("button", { name: "Edit points" }).isEnabled());
await page.getByRole("button", { name: "Edit points" }).click();
let o = await ov();
console.log("nodes:", o.nodes.length, "path:", await path());
// Drag node 1 (top-right) by (-40,+30) screen px.
const n1 = o.nodes[1];
await drag([n1.x, n1.y], [n1.x - 40, n1.y + 30]);
console.log("after drag:", await path());
console.log("selected node:", (await ov()).nodes.findIndex((n) => n.selected));
// Undo is one step.
await page.getByRole("button", { name: "Undo" }).click();
console.log("after undo:", await path());
await page.getByRole("button", { name: "Redo" }).click();
// Add a point by tapping the middle of the bottom edge.
o = await ov();
const [b0, b1] = [o.nodes[2], o.nodes[3]];
await tap([(b0.x + b1.x) / 2, (b0.y + b1.y) / 2 + 3]);
console.log("nodes after tap-add:", (await ov()).nodes.length, "selected index:", (await ov()).nodes.findIndex((n) => n.selected));
await page.getByRole("button", { name: "Smooth" }).click();
console.log("handles after smooth:", (await ov()).handles.length, "path has C:", (await path()).includes("C"));
// Drag a handle.
const h = (await ov()).handles[1];
await drag([h.x, h.y], [h.x, h.y - 50]);
console.log("after handle drag:", await path());
await page.getByRole("button", { name: "Delete point" }).click();
console.log("nodes after delete:", (await ov()).nodes.length);
// Tap empty space deselects.
await tap([20, 20]);
console.log("selected after empty tap:", (await ov()).nodes.findIndex((n) => n.selected));
// Rendered shape follows the edited path: sample a pixel that should now be outside / inside.
await page.getByRole("button", { name: "Done" }).click();
const px = (cx, cy) => page.evaluate(async ([cx, cy]) => { window.__rf.frame(); const r = await window.__rf.renderer.readPixels(); const i = (cy * r.width + cx) * 4; return [...r.data.slice(i, i + 3)]; }, [cx, cy]);
console.log("centre pixel (shape colour expected):", await px(...(await page.evaluate(() => { const c = window.__rf.ctrl; return [Math.round(c.view[4] + c.view[0] * 960), Math.round(c.view[5] + c.view[3] * 540)]; }))));
// Pan-with-finger still works in point mode: pointer type touch must not edit.
console.log("errors:", errors.length ? errors : "none");
await browser.close();
