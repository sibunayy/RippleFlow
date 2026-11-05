// Usage: node scripts/run-pwa.mjs <base url ending in />   (serve a production build first: vite preview)
// Checks: manifest + icons load, the service worker installs, the app launches offline, and an update is offered and applied.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.argv[2];
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const ready = () => page.waitForFunction(() => window.__rf, null, { timeout: 15000 });

const man = await (await ctx.request.get(base + "manifest.webmanifest")).json();
const icons = await Promise.all(man.icons.map(async (i) => (await ctx.request.get(base + i.src)).status()));
console.log("manifest:", man.name, man.display, "| icon statuses:", icons.join(","));

await page.goto(base + "?debug&noloop");
await ready();
const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { active: !!r.active, scope: r.scope }; });
console.log("service worker active:", reg.active, "scope:", reg.scope);
const cached = await page.evaluate(async () => { const ks = await caches.keys(); return { keys: ks, n: (await (await caches.open(ks[0])).keys()).length }; });
console.log("cache:", cached.keys.join(","), "entries:", cached.n);

// Offline cold start.
await page.reload(); await ready(); // make sure the page is controlled
await ctx.setOffline(true);
const offline = await ctx.newPage();
offline.on("pageerror", (e) => errors.push("offline: " + e.message));
await offline.goto(base + "?debug&noloop");
await offline.waitForFunction(() => window.__rf, null, { timeout: 15000 });
console.log("offline launch ok; layers:", await offline.evaluate(() => window.__rf.ctrl.document.layers.length), "| title:", await offline.title());
await offline.getByText("Rect", { exact: true }).click();
console.log("offline edit ok; layers:", await offline.evaluate(() => window.__rf.ctrl.document.layers.length));
await offline.close();
await ctx.setOffline(false);

// Update flow: change the app, rebuild, and check the page is offered the new version.
const oldVersion = await page.evaluate(async () => (await caches.keys())[0]);
const cssPath = "src/app/app.css";
const before = readFileSync(cssPath, "utf8");
appendFileSync(cssPath, "\n.pwa-test-change { color: #123456; }\n");
try { execSync("npx vite build", { stdio: "ignore" }); } finally { writeFileSync(cssPath, before); }
await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
await page.waitForTimeout(2000);
console.log("registration after update():", await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { waiting: r.waiting?.state, installing: r.installing?.state, active: r.active?.state, controller: !!navigator.serviceWorker.controller }; }));
await page.waitForSelector(".update", { timeout: 15000 });
console.log("update banner shown:", (await page.locator(".update").innerText()).replace(/\s+/g, " "));
await page.getByText("Reload", { exact: true }).click();
await page.waitForFunction(() => window.__rf, null, { timeout: 15000 });
await page.waitForFunction(async (old) => { const ks = await caches.keys(); return ks.length === 1 && ks[0] !== old; }, oldVersion, { timeout: 15000 });
console.log("after Reload: old cache removed, new cache:", await page.evaluate(async () => (await caches.keys())[0]), "(was", oldVersion + ")");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
execSync("npx vite build", { stdio: "ignore" }); // leave dist matching the source
