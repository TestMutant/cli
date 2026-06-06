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
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  outDir: "dist",
  banner: {
    js: "#!/usr/bin/env node",
  },
});