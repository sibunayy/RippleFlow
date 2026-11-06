// Usage: node scripts/run-projects.mjs "<app url>?debug&noloop"
// New / open / rename / duplicate / delete projects, backup bundle round trip with an image.
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(500);
const layers = () => page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => l.name));
const name = () => page.evaluate(() => window.__rf.ctrl.document.name);
const rows = () => page.locator(".plist li strong").allInnerTexts();
const dialog = async () => { await page.locator(".proj").click(); await page.waitForSelector(".plist li strong"); };
const saved = () => page.waitForFunction(() => document.querySelector(".save").textContent === "Saved", null, { timeout: 5000 });

console.log("first run name:", await name());
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Star", exact: true }).click(); await saved();
await dialog();
await page.getByLabel("Project name").fill("Logo A"); await page.getByLabel("Project name").press("Enter"); await page.waitForTimeout(300);
console.log("rows after rename:", await rows());
await page.getByText("New project", { exact: true }).click(); await page.waitForTimeout(400);
console.log("new project:", await name(), JSON.stringify(await layers()), "dialog closed:", await page.locator(".modal").count() === 0);
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Ellipse", exact: true }).click(); await saved();
await dialog();
console.log("rows:", await rows());
await page.locator(".plist li", { hasText: "Logo A" }).locator(".pick").click(); await page.waitForTimeout(500);
console.log("opened Logo A:", await name(), JSON.stringify(await layers()));
await page.getByRole("button", { name: "Shapes" }).click(); await page.getByRole("menuitem", { name: "Rect", exact: true }).click(); await saved();
// Reload remembers the last project.
await page.reload(); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(500);
console.log("after reload:", await name(), JSON.stringify(await layers()));
// Duplicate + delete.
await dialog();
await page.locator(".plist li", { hasText: "Logo A" }).getByText("Duplicate").click(); await page.waitForTimeout(500);
console.log("after duplicate:", await rows());
const del = page.locator(".plist li", { hasText: "Logo A copy" }).getByText("Delete");
await del.click(); console.log("delete button after 1 tap:", await del.innerText());
await del.click(); await page.waitForTimeout(500);
console.log("after delete:", await rows());
// Backup with an image, delete project, restore.
await page.locator("body").click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
await page.getByText("Done", { exact: true }).click();
await page.locator('input[type=file][accept="image/*"]').setInputFiles("/tmp/claude-0/px.png");
await page.waitForFunction(() => window.__rf.ctrl.document.layers.some((l) => l.kind === "image"));
await saved();
await dialog();
await page.getByText("Prepare backup file").click();
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByText("Download", { exact: true }).click()]);
const path = "/tmp/claude-0/backup.rippleflow"; await dl.saveAs(path);
console.log("backup file:", dl.suggestedFilename());
await page.locator(".plist li.current").getByText("Delete").click();
await page.locator(".plist li.current").getByText("Confirm delete").click(); await page.waitForTimeout(800);
console.log("after deleting open project, now open:", await name(), "rows:", await rows());
// Wipe assets to prove the bundle carries them.
await page.evaluate(async () => { await (await navigator.storage.getDirectory()).removeEntry("assets", { recursive: true }).catch(() => {}); });
await page.locator('.sheet input[type=file]').setInputFiles(path); await page.waitForTimeout(1000);
console.log("restored:", await name(), JSON.stringify(await layers()));
const asset = await page.evaluate(async () => { const l = window.__rf.ctrl.document.layers.find((x) => x.kind === "image"); const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("assets"); return (await (await d.getFileHandle(l.image.asset)).getFile()).size; });
console.log("image asset restored bytes:", asset);
// Bad file.
await dialog();
await page.locator('.sheet input[type=file]').setInputFiles({ name: "x.rippleflow", mimeType: "application/octet-stream", buffer: Buffer.from("not a bundle at all") });
await page.waitForTimeout(500);
console.log("bad file note:", await page.locator(".sheet .warn").innerText());
console.log("errors:", errors.length ? errors : "none");
await browser.close();
