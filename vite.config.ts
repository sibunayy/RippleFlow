import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  base: "./",
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
