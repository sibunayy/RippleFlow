// Usage: node scripts/run-persist.mjs "<app url>?debug&noloop"
// Edits, waits for autosave, reloads and checks the project came back; then corrupts the file and checks it is preserved.
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const url = process.argv[2];
const open = async () => { await page.goto(url); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(400); };
const summary = () => page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => [l.id, l.name, l.transform.rotation.keys.length]));
const status = () => page.locator(".save").innerText();

await open();
console.log("fresh load layers:", JSON.stringify(await summary()), "status:", await status());
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Star", exact: true }).click();
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click();
await page.getByLabel("Rotation degrees").fill("45"); await page.getByLabel("Rotation degrees").press("Enter");
console.log("right after edit status:", await status());
await page.waitForFunction(() => document.querySelector(".save").textContent === "Saved", null, { timeout: 5000 });
console.log("after wait status:", await status());

await open();
console.log("after reload layers:", JSON.stringify(await summary()), "status:", await status());
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Ellipse", exact: true }).click();
console.log("new layer id after reload (expect layer-3):", await page.evaluate(() => window.__rf.ctrl.selection));

// Edit then hide the page immediately: the flush on visibilitychange must save without waiting for the debounce.
await page.getByLabel("Rotation degrees").fill("10"); await page.getByLabel("Rotation degrees").press("Enter");
await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(200);
await open();
console.log("after hide+reload layers:", JSON.stringify(await summary()));

// Corrupt the stored file of the open project. It must be left alone (not overwritten), flagged in the list, and the app must still start.
const cur = await page.evaluate(() => localStorage.getItem("rf.current"));
await page.evaluate(async (id) => {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("projects");
  const w = await (await d.getFileHandle(id + ".json")).createWritable();
  await w.write("{broken"); await w.close();
}, cur);
await open();
console.log("corrupt -> app opened a different project, layers:", JSON.stringify(await summary()), "notice:", (await page.locator(".notice").innerText()).slice(0, 80));
const kept = await page.evaluate(async (id) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("projects"); return (await (await d.getFileHandle(id + ".json")).getFile()).text(); }, cur);
console.log("damaged file untouched:", kept === "{broken");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
