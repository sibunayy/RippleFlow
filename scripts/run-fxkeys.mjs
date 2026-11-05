// Usage: node scripts/run-fxkeys.mjs "<app url>?debug&noloop"
// Effect and trim keyframes appear as timeline diamonds and can be deleted from there.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(800);
const check = (n, ok, extra = "") => console.log(ok ? "PASS" : "FAIL", n, extra);
await page.getByRole("button", { name: "Rect", exact: true }).click().catch(async () => { await page.getByRole("button", { name: /Rect|Shape/ }).first().click(); });
const keys = () => page.locator(".tl-row .key").count();
const before = await keys();
await page.evaluate(() => {
  const { ctrl } = window.__rf;
  const d = ctrl.document;
  const tr = (...v) => ({ keys: v.map(([t, value], i) => ({ id: `k${i}`, t, value })) });
  const layers = d.layers.map((l, i, a) => i === a.length - 1 ? { ...l, effects: [{ id: "fxa", type: "blur", values: { radius: tr([0.2, 0], [1.4, 30]) } }] } : l);
  ctrl.replaceDocument({ ...d, layers });
});
await page.waitForTimeout(300);
const after = await keys();
check("blur radius keys show as diamonds", before === 0 && after === 3, `(${before} -> ${after}: base key at 0 plus the two blur keys)`);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
