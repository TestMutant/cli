import { chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = ["dist/index.js", "dist/action.js"];

for (const file of files) {
  if (!existsSync(file)) {
    continue;
  }

  // Real filesystem chmod for Linux/macOS CI.
  try {
    chmodSync(file, 0o755);
  } catch {
    // Windows may ignore executable bits.
  }

  // Git index mode, important on Windows.
  try {
    execFileSync("git", ["update-index", "--chmod=+x", file], {
      stdio: "ignore",
    });
  } catch {
    // Ignore outside git or during package builds.
  }
}