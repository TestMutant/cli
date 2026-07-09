import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "../config";
import { runCi } from "../run-ci";

type PackageInfo = {
  name: string;
  version: string;
};

const packageInfo = readPackageInfo();

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    fail(error.message);
  }

  if (error instanceof Error) {
    fail(
      process.env.TESTMUTANT_DEBUG === "1" && error.stack
        ? error.stack
        : error.message,
    );
  }

  fail(String(error));
});

async function main(): Promise<void> {
  const result = await runCi({
    apiKey: process.env.TESTMUTANT_API_KEY,
    apiUrl: getInput("api_url"),
    runKind: getInput("run_kind") ?? "Advisory",
    repository: getInput("repository"),
    provider: getInput("provider") ?? "GitHub",
    baseUrl: getInput("base_url"),
    environmentName: getInput("environment_name"),
    testSpecId: getInput("test_spec_id"),
    userAgent: `testmutant-action/${packageInfo.version}`,
  });

  console.log("TestMutant run completed.");
  console.log(`Run ID: ${result.runId}`);
  console.log(`Status: ${result.status}`);
  console.log(
    `Tests: ${result.passedTests}/${result.totalTests} passed, ${result.failedTests} failed`,
  );
}

function getInput(name: string): string | undefined {
  const value = process.env[`INPUT_${name.toUpperCase()}`];
  return value?.trim() ? value.trim() : undefined;
}

function fail(message: string): never {
  console.error(message);
  console.error(`::error::${escapeGithubAnnotation(message)}`);
  process.exit(1);
}

function escapeGithubAnnotation(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function readPackageInfo(): PackageInfo {
  const packageJsonPath = join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
  };

  return {
    name: typeof packageJson.name === "string" ? packageJson.name : "@testmutant/cli",
    version: typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
  };
}
