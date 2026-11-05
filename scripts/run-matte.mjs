// Usage: node scripts/run-matte.mjs "<app url>?debug&noloop"
// Pixel checks for vector masks and track mattes.
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
// A: red rect 150..250 x 100..200 (centre 200,150). Backdrop (128,64,255).
const setDoc = (aExtra, others = []) => page.evaluate(([aExtra, others]) => {
  const t = (v) => ({ keys: [{ id: "s" + v, t: 0, value: v }] });
  const e = { keys: [] };
  const mk = (id, x, y, fill, path, ex = {}) => ({ id, name: id, kind: "shape", ...ex, shape: { path, fill },
    transform: { anchorX: t(50), anchorY: t(50), x: t(x), y: t(y), scaleX: e, scaleY: e, rotation: e, opacity: e } });
  const sq = "M0 0 H100 V100 H0 Z";
  const layers = [mk("a", 200, 150, [0.8, 0.2, 0.2, 1], sq, aExtra), ...others.map((o) => mk(o.id, o.x ?? 200, o.y ?? 150, o.fill, o.path ?? sq, o.ex ?? {}))];
  window.__rf.ctrl.view = [1, 0, 0, 1, 0, 0];
  window.__rf.ctrl.replaceDocument({ width: 400, height: 300, fps: 30, duration: 1, background: [0.5, 0.25, 1, 1], layers });
}, [aExtra, others]);
const px = (x, y) => page.evaluate(async ([x, y]) => { window.__rf.frame(); const r = await window.__rf.renderer.readPixels(); const i = (y * r.width + x) * 4; return [...r.data.slice(i, i + 3)]; }, [x, y]);
const show = async (label, pts) => console.log(label, (await Promise.all(pts.map(([x, y]) => px(x, y)))).map((p) => p.join(",")).join("  |  "));
const L = [165, 150], R = [235, 150]; // left half / right half of A
const RED = "204,51,51", BG = "128,64,255";
const mask = (id, path, mode = "add", extra = {}) => ({ id, path, mode, feather: 0, opacity: 1, ...extra });
const LEFT = "M0 0 H50 V100 H0 Z";

console.log(`-- masks (expect left ${RED} / right ${BG} unless noted)`);
await setDoc({ masks: [mask("m1", LEFT)] });                         await show("add left half:", [L, R]);
await setDoc({ masks: [mask("m1", LEFT, "subtract")] });             await show("subtract left (expect left BG, right RED):", [L, R]);
await setDoc({ masks: [mask("m1", LEFT, "add", { inverted: true })] }); await show("inverted left (expect left BG, right RED):", [L, R]);
await setDoc({ masks: [mask("m1", "M0 0 H100 V50 H0 Z"), mask("m2", LEFT, "intersect")] }); await show("top half ∩ left half (top-left only):", [[165, 120], [165, 180], [235, 120]]);
await setDoc({ masks: [mask("m1", LEFT), mask("m2", "M50 0 H100 V100 H50 Z")] }); await show("two adds (whole layer):", [L, R]);
await setDoc({ masks: [mask("m1", LEFT, "add", { opacity: 0.5 })] }); await show("opacity .5 (left half-mix ~166,57,153 / right BG):", [L, R]);
await setDoc({ masks: [mask("m1", LEFT, "add", { feather: 30 })] });  await show("feather 30: edge (x=200) ~half, deep left red, deep right BG:", [[200, 150], [160, 150], [240, 150]]);

console.log("-- track mattes (A is shown through B, B hidden)");
const B = (fill, ex = {}, path = LEFT) => ({ id: "b", fill, path, x: 200, y: 150, ex: { hidden: true, ...ex } }); // left half of A's area: B spans 150..200 (x=200 with anchor 50)
await setDoc({ matte: { source: "b", mode: "alpha" } }, [B([0, 1, 0, 1])]); await show("alpha: left RED / right BG:", [L, R]);
await setDoc({ matte: { source: "b", mode: "alphaInverted" } }, [B([0, 1, 0, 1])]); await show("alpha inverted: left BG / right RED:", [L, R]);
await setDoc({ matte: { source: "b", mode: "luma" } }, [B([1, 1, 1, 1])]); await show("luma white: left RED / right BG:", [L, R]);
await setDoc({ matte: { source: "b", mode: "luma" } }, [B([0, 0, 0, 1])]); await show("luma black: both BG:", [L, R]);
await setDoc({ matte: { source: "b", mode: "lumaInverted" } }, [B([0, 0, 0, 1])]); await show("luma inverted black: left RED / right BG:", [L, R]);
await setDoc({ matte: { source: "b", mode: "alpha" } }, [B([0, 1, 0, 1], { outPoint: 0 })]); await show("matte layer not visible: layer hidden (both BG):", [L, R]);
await setDoc({ matte: { source: "b", mode: "alpha" } }, [{ ...B([0, 1, 0, 1]), ex: { hidden: false } }]); await show("matte not hidden: green B visible on top left, A left under it:", [L, R]);
await setDoc({ matte: { source: "b", mode: "alpha" }, masks: [mask("m1", "M0 0 H100 V50 H0 Z")] }, [B([0, 1, 0, 1])]); await show("matte + mask (left half, top only):", [[165, 120], [165, 180], [235, 120]]);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
