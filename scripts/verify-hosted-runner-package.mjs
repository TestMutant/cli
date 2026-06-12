import { accessSync, constants, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const distIndex = join(root, "dist", "index.js");
const distAction = join(root, "dist", "action.js");

assertEqual(packageJson.main, "dist/index.js", "package main must point at dist/index.js");
assertEqual(packageJson.bin?.testmutant, "dist/index.js", "testmutant bin must point at dist/index.js");
assertIncludes(packageJson.files, "dist", "package files must include dist");

for (const dependency of ["@playwright/test", "commander", "dotenv", "playwright", "ws"]) {
  if (!packageJson.dependencies?.[dependency]) {
    fail(`package dependencies must include ${dependency}`);
  }
}

assertExecutableEntry(distIndex, true);
assertExecutableEntry(distAction, false);

assertHostedCommandFailsFast("hosted-run", "TESTMUTANT_HOSTED_RUNNER_JOB_ID");
assertHostedCommandFailsFast("hosted-env-check", "TESTMUTANT_HOSTED_RUNNER_JOB_ID");

const npm = npmInvocation();
const pack = spawnSync(npm.command, [...npm.args, "pack", "--dry-run", "--json"], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    npm_config_cache: isolatedNpmCache(),
  },
  windowsHide: true,
});

if (pack.status !== 0) {
  fail(`npm pack --dry-run failed:\n${pack.error?.message || pack.stderr || pack.stdout}`);
}

const packedFiles = parsePackedFiles(pack.stdout);
for (const expectedFile of ["dist/index.js", "dist/action.js", "package.json"]) {
  if (!packedFiles.has(expectedFile)) {
    fail(`package dry run did not include ${expectedFile}`);
  }
}

console.log("Hosted runner package invocation smoke passed.");

function assertExecutableEntry(file, requiresShebang) {
  accessSync(file, constants.R_OK);
  const source = readFileSync(file, "utf8");

  if (requiresShebang && !source.startsWith("#!/usr/bin/env node")) {
    fail(`${basename(file)} must keep the node shebang for package bin invocation`);
  }

  if (process.platform !== "win32") {
    const mode = statSync(file).mode;
    if ((mode & 0o111) === 0) {
      fail(`${basename(file)} must be executable on Linux/container hosts`);
    }
  }
}

function assertHostedCommandFailsFast(command, expectedMessage) {
  const result = spawnSync(
    process.execPath,
    [distIndex, "--json", command],
    {
      cwd: root,
      env: minimalEnv(),
      encoding: "utf8",
      windowsHide: true,
    },
  );

  assertEqual(result.status, 2, `${command} should exit 2 when API-provided env is missing`);

  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedMessage)) {
    fail(`${command} should report missing ${expectedMessage}; output was:\n${output}`);
  }
}

function minimalEnv() {
  const env = {};
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TMP", "TEMP"]) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }

  return env;
}

function parsePackedFiles(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    fail(`Could not parse npm pack --dry-run JSON:\n${stdout}`);
  }

  const files = parsed?.[0]?.files;
  if (!Array.isArray(files)) {
    fail(`npm pack --dry-run output did not include a files list:\n${stdout}`);
  }

  return new Set(files.map((file) => file.path));
}

function npmInvocation() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath],
    };
  }

  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: [],
  };
}

function isolatedNpmCache() {
  const cache = join(tmpdir(), "testmutant-cli-npm-cache");
  mkdirSync(cache, { recursive: true });
  return cache;
}

function assertIncludes(values, expected, message) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    fail(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
