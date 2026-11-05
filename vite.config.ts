import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  base: "./",
  build: { rollupOptions: { input: { main: "index.html", spike: "spike.html", export: "export.html", input: "input.html" } } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
