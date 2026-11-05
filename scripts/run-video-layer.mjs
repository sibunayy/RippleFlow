// Usage: node scripts/run-video-layer.mjs "<app url>?debug&noloop&videoMode=bitmap" <coded.mp4> <rotated.mp4> <out.mp4>
// Imports the frame-index-coded clip through the real UI and checks, from rendered pixels, that every playhead time shows the right frame.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const [url, clip, rot, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const open = async () => { await page.goto(url); await page.waitForFunction(() => window.__rf); await page.waitForTimeout(300); };

// Decode the 16-bit frame index from rendered pixels. `map(b)` gives the composition point of bit b's square centre.
const readIndex = (layout) => page.evaluate(async (layout) => {
  const { ctrl, renderer } = window.__rf; const m = ctrl.view;
  const { width, data } = await renderer.readPixels();
  let idx = 0;
  for (let b = 0; b < 16; b++) {
    const [cx, cy] = layout === "rot270" ? [960 + (48 - 540) * 0.5625, 540 + (1920 - (b * 96 + 48) - 960) * 0.5625] : [b * 96 + 48, 48];
    const x = Math.round(m[0] * cx + m[2] * cy + m[4]), y = Math.round(m[1] * cx + m[3] * cy + m[5]);
    const i = (y * width + x) * 4;
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    idx = (idx << 1) | (lum > 128 ? 1 : 0);
  }
  return idx;
}, layout);
// Show composition time t and wait for the decoded frame to land; returns the index the pixels show.
async function showAt(t, layout, want) {
  await page.evaluate((t) => window.__rf.ctrl.setTime(t), t);
  for (let i = 0; i < 80; i++) {
    await page.evaluate(() => window.__rf.frame());
    const got = await readIndex(layout);
    if (got === want) return got;
    await page.waitForTimeout(25);
  }
  return await readIndex(layout);
}

await open();
await page.setInputFiles('input[accept^="video"]', clip);
await page.waitForFunction(() => window.__rf.ctrl.document.layers.length === 1, null, { timeout: 30000 });
const l = await page.evaluate(() => window.__rf.ctrl.document.layers[0]);
console.log("layer:", l.kind, l.name, JSON.stringify(l.video), "in/out", l.inPoint, l.outPoint, "| comp duration", await page.evaluate(() => window.__rf.ctrl.document.duration));

const results = [];
for (const t of [0, 0.5, 1.7, 3.0, 2.0, 5.9, 0.01]) {
  const want = Math.floor(t * 30 + 1e-9);
  results.push([t, want, await showAt(t, "plain", want)]);
}
console.log("scrub (t, expected frame, shown):", JSON.stringify(results), results.every((r) => r[1] === r[2]) ? "ALL OK" : "MISMATCH");

// Sequential playback: 60 consecutive frames, each must show up as the right one.
const t0 = Date.now(); let bad = 0;
for (let i = 40; i < 100; i++) { if ((await showAt(i / 30 + 0.002, "plain", i)) !== i) bad++; }
console.log(`60 consecutive frames: ${bad} wrong, ${Date.now() - t0} ms total (includes ~per-frame readback)`);

// Export 1 s (frames 0..29) at 720p30; decode the index from the MP4 externally.
await page.evaluate(() => { const c = window.__rf.ctrl; c.replaceDocument({ ...c.document, duration: 1 }); });
await page.getByText("Export", { exact: true }).first().click();
await page.getByText("720p · 30 fps").click();
await page.locator(".sheet .primary").click();
await page.waitForSelector(".sheet video", { timeout: 180000 });
const b64 = await page.evaluate(async () => { const buf = new Uint8Array(await (await fetch(document.querySelector(".sheet video").src)).arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); });
writeFileSync(out, Buffer.from(b64, "base64"));
console.log("exported", out);
await page.getByText("Close", { exact: true }).click();

// Persistence: reload and the clip must reappear from storage.
await page.evaluate(() => window.__rf.saver.flush());
await open();
await page.waitForFunction(() => window.__rf.ctrl.document.layers.length === 1);
console.log("after reload: shows frame", await showAt(0.5, "plain", 15), "(expect 15)");

// Rotated clip (ffmpeg -display_rotation 90 is counterclockwise, i.e. 270 clockwise): a new project with just that clip.
await page.evaluate(() => { const c = window.__rf.ctrl; c.replaceDocument({ ...c.document, layers: [], duration: 6 }); });
await page.setInputFiles('input[accept^="video"]', rot);
await page.waitForFunction(() => window.__rf.ctrl.document.layers.length === 1, null, { timeout: 30000 });
const rl = await page.evaluate(() => window.__rf.ctrl.document.layers[0]);
console.log("rotated layer video:", JSON.stringify(rl.video), "scale", rl.transform.scaleX.keys[0].value.toFixed(4));
console.log("rotated shows frame (coded square row read through the 270 degree (clockwise) mapping), t=1.0 expect 30:", await showAt(1.0, "rot270", 30));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
