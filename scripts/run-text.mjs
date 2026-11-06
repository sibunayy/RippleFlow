// Usage: node scripts/run-text.mjs "<app url>?debug&noloop"
// Text layers through the real UI: add, edit, animate per character/word/line, pixels over time, persistence.
import { launch } from "./lib/browser.mjs";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction(() => window.__rf);
await page.waitForTimeout(800);
const check = (n, ok, extra = "") => console.log(ok ? "PASS" : "FAIL", n, extra);
const layer = () => page.evaluate(() => window.__rf.ctrl.document.layers.at(-1));
// Count white pixels at time t.
const lit = (t) => page.evaluate(async (t) => {
  const { ctrl, renderer } = window.__rf;
  ctrl.setTime(t); window.__rf.frame();
  const r = await renderer.readPixels();
  let n = 0; // the text is white on a black backdrop
  for (let i = 0; i < r.data.length; i += 4) if (r.data[i] > 200 && r.data[i + 1] > 200 && r.data[i + 2] > 200) n++;
  return n;
}, t);

await page.evaluate(() => { const d = window.__rf.ctrl.document; window.__rf.ctrl.replaceDocument({ ...d, background: [0, 0, 0, 1] }); });
await page.getByRole("button", { name: "Text", exact: true }).click();
let l = await layer();
check("text layer added", !!l.text && l.text.text === "Hello" && l.shape.path.startsWith("M"));
const still = await lit(0);
check("static text draws pixels", still > 2000, `(${still})`);

await page.getByRole("tab", { name: "Motion" }).click(); await page.getByRole("button", { name: "+ Add", exact: true }).click();
l = await layer();
check("animator added", l.text.animator?.unit === "char");
const t0 = await lit(0), tMid = await lit(0.2), tEnd = await lit(2);
check("nothing visible before the first unit starts", t0 < 50, `(${t0})`);
check("partially built mid-way", tMid > t0 && tMid < tEnd, `(${t0} < ${tMid} < ${tEnd})`);
check("fully built at the end matches static text", Math.abs(tEnd - still) / still < 0.02, `(${tEnd} vs ${still})`);

await page.getByRole("button", { name: "Word", exact: true }).click();
check("unit switched to word", (await layer()).text.animator.unit === "word");

await page.getByRole("tab", { name: "Style" }).click();
await page.locator(".text-input").fill("Hi there\nfriend");
await page.locator(".text-input").blur();
l = await layer();
check("text edited, outline rebuilt", l.text.text === "Hi there\nfriend" && l.shape.path.length > 100);
await page.getByRole("button", { name: "Undo" }).click();
check("undo restores Hello", (await layer()).text.text === "Hello");

// Saved and reloaded.
const round = await page.evaluate(async () => {
  const { serialize, deserialize } = await import("/src/persist/serialize.ts");
  const doc = window.__rf.ctrl.document;
  return JSON.stringify(deserialize(serialize(doc)).layers.at(-1).text) === JSON.stringify(doc.layers.at(-1).text);
});
check("serialize round trip", round);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
