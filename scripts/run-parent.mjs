// Usage: node scripts/run-parent.mjs "<app url>?debug&noloop"
// Null layer + Parent picker: the child follows the null; cycles are not offered.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.getByRole("tab", { name: "Motion" }).click();
await page.waitForTimeout(600);
const check = (n, ok) => console.log(ok ? "PASS" : "FAIL", n);
const items = () => page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => ({ id: l.id, parent: l.parent })));
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
const rectId = await page.evaluate(() => window.__rf.ctrl.selection);
await page.getByRole("button", { name: "Null" }).click();
const nullId = await page.evaluate(() => window.__rf.ctrl.selection);
check("null layer added and selected", nullId !== rectId);
await page.evaluate((id) => window.__rf.ctrl.setSelection(id), rectId);
await page.getByLabel("Parent layer").selectOption(nullId);
check("rect parented to null", (await items()).find((l) => l.id === rectId).parent === nullId);
// Moving the null moves the rect in world space.
await page.evaluate((id) => window.__rf.ctrl.setSelection(id), nullId);
await page.evaluate((id) => window.__rf.ctrl.setSelection(id), nullId);
const offered = await page.getByLabel("Parent layer").locator("option").allInnerTexts();
check("null cannot pick its own child", !offered.some((t) => t.startsWith("Rect")));
await page.evaluate((id) => window.__rf.ctrl.setSelection(id), rectId);
await page.getByLabel("Parent layer").selectOption("");
check("parent cleared", (await items()).find((l) => l.id === rectId).parent === undefined);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
