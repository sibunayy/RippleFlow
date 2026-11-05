import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

/** Writes dist/sw.js: the template plus the list of every built file and a content-hash version. */
function serviceWorker(): Plugin {
  let outDir = "dist";
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  return {
    name: "rippleflow-sw",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split("\\").join("/"))
        .filter((f) => f !== "sw.js" && !f.startsWith("clips/")) // clips are test media, fetched on demand
        .sort();
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest("hex").slice(0, 12);
      const list = ["./", ...files].map((f) => (f === "./" ? f : `./${f}`));
      const src = readFileSync("scripts/sw-template.js", "utf8").replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(list));
      writeFileSync(join(outDir, "sw.js"), src);
    },
  };
}

/** Short git commit of this build, so a device can say which version it is running. */
function buildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  plugins: [solid(), serviceWorker()],
  base: "./",
  build: { rollupOptions: { input: { main: "index.html", spike: "spike.html", export: "export.html", video: "video.html", input: "input.html" } } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
