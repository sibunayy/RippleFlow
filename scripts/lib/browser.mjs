// Shared Playwright launch for the scripts/run-*.mjs checks (software WebGPU for the container).
// Playwright itself is resolved through NODE_PATH=$(npm root -g).
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
export const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"];
export const launch = (opts = {}) => chromium.launch({ args: GPU_ARGS, ...opts });
