// Usage: node scripts/run-image.mjs "<app url>?debug&noloop" <image.png> <big-image.png> <out.mp4>
// Imports pictures through the real UI, checks colours/orientation on screen, exports, then reloads to check persistence.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [url, img, big, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const open = async () => { await page.goto(url); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300); };
await page.getByRole("button", { name: "Transform", exact: true }).click(); // the transform panel is tucked away by default
const frame = () => page.evaluate(() => window.__rf.frame());
// Pixel at a COMPOSITION point, through the editor view, by offscreen readback.
const px = (cx, cy) => page.evaluate(async ([cx, cy]) => {
  const { ctrl, renderer } = window.__rf; const m = ctrl.view;
  const x = Math.round(m[0] * cx + m[2] * cy + m[4]), y = Math.round(m[1] * cx + m[3] * cy + m[5]);
  const { width, data } = await renderer.readPixels(); const i = (y * width + x) * 4;
  return [...data.slice(i, i + 3)];
}, [cx, cy]);
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 14);
const spots = { TL: [[744, 378], [255, 0, 0]], TR: [[1176, 378], [0, 255, 0]], BL: [[744, 702], [0, 0, 255]], BR: [[1176, 702], [255, 255, 0]] };
const check = async (label) => {
  await frame();
  const r = {}; for (const [k, [p, want]] of Object.entries(spots)) { const got = await px(...p); r[k] = near(got, want) ? "ok" : `WRONG ${got}`; }
  console.log(label, JSON.stringify(r));
};

await open();
await page.setInputFiles('input[accept="image/*"]', img);
await page.waitForFunction(() => window.__rf.ctrl.document.layers.length === 1);
const l = await page.evaluate(() => window.__rf.ctrl.document.layers[0]);
console.log("layer:", l.kind, l.name, JSON.stringify(l.image), "scale", l.transform.scaleX.keys[0].value.toFixed(3));
await check("on screen:");

// Opacity 50% over the white backdrop -> colours wash out toward white.
await page.getByLabel("Opacity %").fill("50"); await page.getByLabel("Opacity %").press("Enter");
await frame();
console.log("50% opacity red over white (expect ~255,128,128):", await px(744, 378));
await page.getByLabel("Opacity %").fill("100"); await page.getByLabel("Opacity %").press("Enter");

// Large picture is downscaled on import.
await page.setInputFiles('input[accept="image/*"]', big);
await page.waitForFunction(() => window.__rf.ctrl.document.layers.length === 2);
console.log("big import:", JSON.stringify(await page.evaluate(() => window.__rf.ctrl.document.layers[1].image)));
await page.evaluate(() => window.__rf.ctrl.undo()); // drop the big one again so the spots are unambiguous

// Export 1 s at 720p30 and save for ffmpeg.
await page.evaluate(() => { const c = window.__rf.ctrl; c.replaceDocument({ ...c.document, duration: 1 }); });
await page.getByText("Export", { exact: true }).first().click();
await page.getByText(process.env.PRESET ?? "720p · 30 fps").click();
await page.locator(".sheet .primary").click();
await page.waitForSelector(".sheet video", { timeout: 120000 });
const b64 = await page.evaluate(async () => { const buf = new Uint8Array(await (await fetch(document.querySelector(".sheet video").src)).arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); });
writeFileSync(out, Buffer.from(b64, "base64"));
console.log("exported", out);
await page.getByText("Close", { exact: true }).click();

// Persistence: wait for autosave, reload, picture must come back from OPFS.
await page.evaluate(() => window.__rf.saver.flush());
await open();
console.log("after reload layers:", await page.evaluate(() => window.__rf.ctrl.document.layers.map((l) => l.kind)));
await page.waitForFunction(() => window.__rf.ctrl.bitmapOf(window.__rf.ctrl.document.layers[0].image.asset));
await check("after reload:");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
