import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  base: "./",
  build: { rollupOptions: { input: { main: "index.html", spike: "spike.html" } } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
