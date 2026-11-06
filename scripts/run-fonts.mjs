// Usage: node scripts/run-fonts.mjs "<app url>?debug&noloop"
// Text fonts through the real UI: pick each font, outline changes, survives save/load, undo restores.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(800);
const check = (n, ok, extra = "") => console.log(ok ? "PASS" : "FAIL", n, extra);
const layer = () => page.evaluate(() => window.__rf.ctrl.document.layers.at(-1));
await page.getByRole("button", { name: "Text", exact: true }).click();
const base = await layer();
check("default font has no font field", base.text.font === undefined);
const seen = new Set([base.shape.path]);
for (const id of ["poppins", "bebas", "playfair", "pacifico", "spacemono"]) {
  await page.locator("select.font-select").selectOption(id);
  await page.waitForFunction((id) => window.__rf.ctrl.document.layers.at(-1).text.font === id, id, { timeout: 5000 }).catch(() => {});
  const l = await layer();
  check(`font ${id} applied`, l.text.font === id && l.shape.path.length > 50);
  check(`font ${id} outline differs`, !seen.has(l.shape.path));
  seen.add(l.shape.path);
}
await page.getByRole("button", { name: "Undo" }).click();
check("undo goes back one font", (await layer()).text.font === "pacifico");
await page.locator("select.font-select").selectOption("inter");
await page.waitForTimeout(300);
const back = await layer();
check("choosing Inter clears the field", back.text.font === undefined && back.shape.path === base.shape.path);
const round = await page.evaluate(async () => {
  const { serialize, deserialize } = await import("/src/persist/serialize.ts");
  const ctrl = window.__rf.ctrl;
  const doc = ctrl.document;
  const withFont = { ...doc, layers: doc.layers.map((l, i, a) => (i === a.length - 1 ? { ...l, text: { ...l.text, font: "bebas" } } : l)) };
  return deserialize(serialize(withFont)).layers.at(-1).text.font;
});
check("font id survives serialize", round === "bebas");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
