import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    action: "src/action.ts",
  },
  format: ["cjs"],
  target: "node20",
  platform: "node",
  bundle: true,
  external: ["@playwright/test", "playwright"],
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  outDir: "dist",
});
