#!/usr/bin/env node

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { TestMutantApiClient } from "./api-client";
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

function readPackageInfo(): { version: string } {
  const packageJsonPath = join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };

  return {
    version:
      typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
  };
}
