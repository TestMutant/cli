import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { CliError } from "./config";

export async function ensurePlaywrightBrowserInstalled(): Promise<void> {
  const runtimeRequire = createRequire(__filename);
  const playwrightCliPath = join(
    dirname(runtimeRequire.resolve("playwright/package.json")),
    "cli.js",
  );

  const args =
    process.platform === "linux"
      ? [playwrightCliPath, "install", "--with-deps", "chromium"]
      : [playwrightCliPath, "install", "chromium"];

  const result = await execNode(args);

  if (result.exitCode !== 0) {
    throw new CliError(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Failed to install Playwright Chromium browser.",
    );
  }
}

function execNode(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      {
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;

        resolve({ exitCode, stdout, stderr });
      },
    );
  });
}