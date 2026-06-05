#!/usr/bin/env node

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { TestMutantApiClient } from "./api-client";
import { buildCreateRunRequest } from "./ci-metadata";
import {
  API_KEY_ENV_VAR,
  API_URL_ENV_VAR,
  CliError,
  DEFAULT_API_URL,
  resolveConfig,
} from "./config";

type GlobalOptions = {
  apiKey?: string;
  apiUrl?: string;
  json?: boolean;
  timeout?: string;
};

type PackageInfo = {
  name: string;
  version: string;
};

const packageInfo = readPackageInfo();
const program = new Command();

program
  .name("testmutant")
  .description("Run TestMutant workflows locally or in CI.")
  .version(packageInfo.version)
  .option("-k, --api-key <key>", `TestMutant API key. Defaults to ${API_KEY_ENV_VAR}.`)
  .option(
    "-u, --api-url <url>",
    `TestMutant API base URL. Defaults to ${API_URL_ENV_VAR} or ${DEFAULT_API_URL}.`,
  )
  .option("--timeout <ms>", "API request timeout in milliseconds.", "30000")
  .option("--json", "Print command output as JSON.");

program.hook("preAction", async () => {
  const options = program.opts<GlobalOptions>();

  if (options.json) {
    return;
  }

  await printUpdateReminder(packageInfo);
});

program
  .command("ping")
  .description("Verify the CLI can authenticate with the TestMutant API.")
  .action(async () => {
    const options = program.opts<GlobalOptions>();
    const config = resolveConfig(options);
    const client = new TestMutantApiClient({
      ...config,
      userAgent: `testmutant-cli/${packageInfo.version}`,
    });
    const ping = await client.ping();

    if (options.json) {
      console.log(JSON.stringify(ping, null, 2));
      return;
    }

    console.log("Connected to TestMutant.");
    console.log(`Organization: ${ping.organizationName} (${ping.organizationId})`);
    console.log(`CLI API version: ${ping.cliApiVersion}`);
  });

program
  .command("ci")
  .description("Create and complete a TestMutant CI run.")
  .action(async () => {
    const options = program.opts<GlobalOptions>();
    const config = resolveConfig(options);
    const client = new TestMutantApiClient({
      ...config,
      userAgent: `testmutant-cli/${packageInfo.version}`,
    });

    const createRunRequest = buildCreateRunRequest();
    const created = await client.createRun(createRunRequest);
    const completed = await client.completeRun(created.runId, {
      status: "Passed",
      summary: "CI metadata captured.",
      results: null,
      resultJson: null,
      errorMessage: null,
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          { runId: completed.runId, status: completed.status },
          null,
          2,
        ),
      );
      return;
    }

    console.log(`Run ID: ${completed.runId}`);
    console.log(`Status: ${completed.status}`);
  });

program.showHelpAfterError();

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.error(String(error));
  process.exitCode = 1;
});

function readPackageInfo(): PackageInfo {
  const packageJsonPath = join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
  };

  return {
    name: typeof packageJson.name === "string" ? packageJson.name : "@testmutant/cli",
    version:
      typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
  };
}

async function printUpdateReminder(packageInfo: PackageInfo): Promise<void> {
  const latestVersion = await fetchLatestPackageVersion(packageInfo.name);

  if (!latestVersion || !isNewerVersion(latestVersion, packageInfo.version)) {
    return;
  }

  console.log(
    `There is a newer TestMutant CLI version available (${packageInfo.version} -> ${latestVersion}). Run npm install -g ${packageInfo.name}@latest to update.`,
  );
  console.log("");
}

async function fetchLatestPackageVersion(
  packageName: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);

  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isNewerVersion(candidate: string, current: string): boolean {
  const candidateVersion = parseSemver(candidate);
  const currentVersion = parseSemver(current);

  if (!candidateVersion || !currentVersion) {
    return candidate !== current;
  }

  for (const key of ["major", "minor", "patch"] as const) {
    if (candidateVersion[key] > currentVersion[key]) {
      return true;
    }

    if (candidateVersion[key] < currentVersion[key]) {
      return false;
    }
  }

  if (!candidateVersion.prerelease && currentVersion.prerelease) {
    return true;
  }

  if (candidateVersion.prerelease && !currentVersion.prerelease) {
    return false;
  }

  return (
    Boolean(candidateVersion.prerelease && currentVersion.prerelease) &&
    candidateVersion.prerelease > currentVersion.prerelease
  );
}

function parseSemver(value: string):
  | {
      major: number;
      minor: number;
      patch: number;
      prerelease: string;
    }
  | null {
  const match = value
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/);

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}
