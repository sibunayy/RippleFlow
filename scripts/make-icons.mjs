// Renders the app icon from an SVG into PNGs: node scripts/make-icons.mjs
// Run with NODE_PATH=$(npm root -g). Output goes to public/icons and public/apple-touch-icon.png.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

// Concentric ripples on a dark rounded field. `pad` shrinks the art for maskable icons (safe zone).
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#181c28"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)" fill="none" stroke-linecap="round">
    <circle cx="256" cy="256" r="58" fill="#4aa3ff" stroke="none"/>
    <circle cx="256" cy="256" r="112" stroke="#4aa3ff" stroke-width="22" opacity="0.85"/>
    <circle cx="256" cy="256" r="166" stroke="#4aa3ff" stroke-width="22" opacity="0.55"/>
    <circle cx="256" cy="256" r="220" stroke="#4aa3ff" stroke-width="22" opacity="0.3"/>
  </g></svg>`;

const jobs = [
  ["public/icons/icon-192.png", 192, 0],
  ["public/icons/icon-512.png", 512, 0],
  ["public/icons/maskable-512.png", 512, 0.2],
  ["public/apple-touch-icon.png", 180, 0],
];
mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [path, size, pad] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg(pad)}`);
  writeFileSync(path, await page.screenshot({ omitBackground: false }));
  console.log("wrote", path);
}
await browser.close();
