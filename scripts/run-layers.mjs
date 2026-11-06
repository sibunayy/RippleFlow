// Usage: node scripts/run-layers.mjs "<app url>?debug&noloop"
// Timeline layer controls: duplicate, rename, hide/show, indent under a parent.
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept("Hero"));
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(500);
const check = (n, ok, extra = "") => console.log(ok ? "PASS" : "FAIL", n, extra);
const layers = () => page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => ({ id: l.id, name: l.name, hidden: !!l.hidden, parent: l.parent })));
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
await page.getByRole("button", { name: "Duplicate" }).click();
let ls = await layers();
check("duplicate adds a copy and selects it", ls.length === 2 && ls[1].name.endsWith("copy") && (await page.evaluate(() => window.__rf.ctrl.selection)) === ls[1].id);
await page.getByRole("button", { name: "More layer actions" }).click(); await page.getByRole("menuitem", { name: "Rename layer" }).click();
check("rename via prompt", (await layers())[1].name === "Hero");
await page.locator(".tl-row .eye[aria-label^='Hide']").first().click();
check("eye hides the layer", (await layers()).some((l) => l.hidden));
const hiddenScene = await page.evaluate(() => window.__rf.ctrl.scene().length);
check("hidden layer leaves the scene", hiddenScene === 1);
await page.locator(".tl-row .eye[aria-label^='Show']").click();
check("eye shows it again", (await layers()).every((l) => !l.hidden));
await page.getByRole("button", { name: "Undo" }).click();
check("undo is one step", (await layers()).some((l) => l.hidden));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
