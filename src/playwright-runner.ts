import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensurePlaywrightBrowserInstalled } from "./playwright-install";
import { createRequire } from "node:module";
import type { CliRunImplementation } from "./api-client";

export type TestRunStatus = "Passed" | "Failed";

export type TestRunResult = {
  implementationId: string;
  runnerKind: string;
  name: string;
  status: TestRunStatus;
  errorMessage: string | null;
  durationMs: number | null;
};

export type TestRunSummary = {
  kind: "playwright";
  baseUrl: string | null;
  total: number;
  passed: number;
  failed: number;
  tests: TestRunResult[];
};

export type PlaywrightExecutionOptions = {
  baseUrl?: string | null;
  cwd?: string;
  commandRunner?: PlaywrightCommandRunner;
};

export type PlaywrightCommandRunner = (
  command: string,
  args: string[],
  options: PlaywrightCommandOptions,
) => Promise<PlaywrightCommandResult>;

export type PlaywrightCommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type PlaywrightCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type WrittenTest = {
  test: CliRunImplementation;
  filePath: string;
  fileName: string;
};

type PlaywrightJsonReport = {
  suites?: PlaywrightSuite[];
  errors?: PlaywrightError[];
};

type PlaywrightSuite = {
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
};

type PlaywrightSpec = {
  title?: string;
  ok?: boolean;
  tests?: PlaywrightCase[];
};

type PlaywrightCase = {
  ok?: boolean;
  results?: PlaywrightCaseResult[];
};

type PlaywrightCaseResult = {
  status?: string;
  duration?: number;
  error?: PlaywrightError;
  errors?: PlaywrightError[];
};

type PlaywrightError = {
  message?: string;
  stack?: string;
};

const PLAYWRIGHT_TYPE = "playwright";

export async function runPlaywrightTests(
  tests: CliRunImplementation[],
  options: PlaywrightExecutionOptions = {},
): Promise<TestRunSummary> {
  const supported = tests.filter(isPlaywrightTest);
  const unsupported = tests.filter((test) => !isPlaywrightTest(test));
  const unsupportedResults = unsupported.map<TestRunResult>((test) => ({
    implementationId: test.implementationId,
    runnerKind: test.runnerKind,
    name: test.name,
    status: "Failed",
    errorMessage: `Unsupported runner kind: ${test.runnerKind}`,
    durationMs: null,
  }));

  if (supported.length === 0) {
    return summarize(options.baseUrl ?? null, unsupportedResults);
  }

  const workDir = await mkdtemp(join(tmpdir(), "testmutant-playwright-"));

  try {
    const writtenTests = await writePlaywrightWorkspace(
      workDir,
      supported,
      options.baseUrl ?? null,
    );

    const commandRunner = options.commandRunner ?? defaultCommandRunner;

    await ensurePlaywrightBrowserInstalled();

    const result = await commandRunner(
      process.execPath,
      getPlaywrightTestArgs(workDir, writtenTests),
      {
        cwd: workDir,
        env: {
          ...process.env,
          NODE_PATH: buildNodePath(process.env.NODE_PATH),
        },
      },
    );

    const mappedResults = mapPlaywrightResults(writtenTests, result);
    return summarize(options.baseUrl ?? null, [
      ...mappedResults,
      ...unsupportedResults,
    ]);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function isPlaywrightTest(test: CliRunImplementation): boolean {
  return test.runnerKind.trim().toLowerCase() === PLAYWRIGHT_TYPE;
}

async function writePlaywrightWorkspace(
  workDir: string,
  tests: CliRunImplementation[],
  baseUrl: string | null,
): Promise<WrittenTest[]> {
  await writeFile(
    join(workDir, "playwright.config.cjs"),
    [
      "module.exports = {",
      "  timeout: 30000,",
      "  workers: 1,",
      "  use: {",
      `    baseURL: ${JSON.stringify(baseUrl)},`,
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  const writtenTests: WrittenTest[] = [];
  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index]!;
    const fileName = `${String(index + 1).padStart(3, "0")}-${safeFilePart(
      test.implementationId,
    )}.spec.ts`;
    const filePath = join(workDir, fileName);
    await writeFile(filePath, test.source, "utf8");
    writtenTests.push({ test, filePath, fileName });
  }

  return writtenTests;
}

function mapPlaywrightResults(
  writtenTests: WrittenTest[],
  commandResult: PlaywrightCommandResult,
): TestRunResult[] {
  const report = parsePlaywrightReport(commandResult.stdout);
  const fileResults = new Map<string, TestRunResult>();

  const fallbackError =
    firstReportError(report) ??
    meaningfulStderr(commandResult.stderr) ??
    extractUsefulPlaywrightFailure(commandResult.stdout);

  if (report) {
    for (const suite of report.suites ?? []) {
      collectSuiteResults(suite, writtenTests, fileResults, fallbackError);
    }
  }

  return writtenTests.map(({ test, fileName }) => {
    const mapped = fileResults.get(fileName);
    if (mapped) {
      return mapped;
    }

    return {
      implementationId: test.implementationId,
      runnerKind: test.runnerKind,
      name: test.name,
      status: commandResult.exitCode === 0 ? "Passed" : "Failed",
      errorMessage: commandResult.exitCode === 0 ? null : fallbackError,
      durationMs: null,
    };
  });
}

function collectSuiteResults(
  suite: PlaywrightSuite,
  writtenTests: WrittenTest[],
  fileResults: Map<string, TestRunResult>,
  fallbackError: string | null,
): void {
  const fileName = suite.file ? suite.file.replace(/\\/g, "/").split("/").pop() : null;
  const writtenTest = fileName
    ? writtenTests.find((candidate) => candidate.fileName === fileName)
    : undefined;

  if (writtenTest && fileName) {
    const specs = suite.specs ?? [];
    const failedSpec = specs.find((spec) => spec.ok === false);
    const failedCase = specs
      .flatMap((spec) => spec.tests ?? [])
      .find((testCase) => testCase.ok === false);
    const result = failedCase?.results?.find(
      (caseResult) => caseResult.status && caseResult.status !== "passed",
    );

    fileResults.set(fileName, {
      implementationId: writtenTest.test.implementationId,
      runnerKind: writtenTest.test.runnerKind,
      name: writtenTest.test.name,
      status: failedSpec || failedCase ? "Failed" : "Passed",
      errorMessage:
        failedSpec || failedCase
          ? formatResultError(result) ?? fallbackError ?? "Playwright test failed."
          : null,
      durationMs: sumDurations(specs),
    });
  }

  for (const child of suite.suites ?? []) {
    collectSuiteResults(child, writtenTests, fileResults, fallbackError);
  }
}

function parsePlaywrightReport(stdout: string): PlaywrightJsonReport | null {
  try {
    return JSON.parse(stdout) as PlaywrightJsonReport;
  } catch {
    return null;
  }
}

function firstReportError(report: PlaywrightJsonReport | null): string | null {
  const error = report?.errors?.find((candidate) =>
    Boolean(candidate.message ?? candidate.stack),
  );
  return error ? formatError(error) : null;
}

function formatResultError(result: PlaywrightCaseResult | undefined): string | null {
  if (!result) {
    return null;
  }

  const error = result.error ?? result.errors?.[0];
  return error ? formatError(error) : null;
}

function formatError(error: PlaywrightError): string {
  return truncate(firstNonEmpty(error.message, error.stack) ?? "Playwright test failed.");
}

function sumDurations(specs: PlaywrightSpec[]): number | null {
  const duration = specs
    .flatMap((spec) => spec.tests ?? [])
    .flatMap((testCase) => testCase.results ?? [])
    .reduce((total, result) => total + (result.duration ?? 0), 0);

  return duration > 0 ? duration : null;
}

function summarize(baseUrl: string | null, tests: TestRunResult[]): TestRunSummary {
  const passed = tests.filter((test) => test.status === "Passed").length;
  const failed = tests.length - passed;

  return {
    kind: "playwright",
    baseUrl,
    total: tests.length,
    passed,
    failed,
    tests,
  };
}

function getPlaywrightCliPath(): string {
  const runtimeRequire = createRequire(__filename);
  return join(dirname(runtimeRequire.resolve("playwright/package.json")), "cli.js");
}

function buildNodePath(existing: string | undefined): string {
  const runtimeRequire = createRequire(__filename);
  const dependencyPath = dirname(
    dirname(dirname(runtimeRequire.resolve("@playwright/test"))),
  );
  return existing ? `${dependencyPath}${delimiter()}${existing}` : dependencyPath;
}
function getPlaywrightInstallArgs(): string[] {
  if (process.platform === "linux") {
    return [getPlaywrightCliPath(), "install", "--with-deps", "chromium"];
  }

  return [getPlaywrightCliPath(), "install", "chromium"];
}

function getPlaywrightTestArgs(
  workDir: string,
  writtenTests: WrittenTest[],
): string[] {
  return [
    getPlaywrightCliPath(),
    "test",
    "--config",
    join(workDir, "playwright.config.cjs"),
    "--reporter=json",
    ...writtenTests.map((writtenTest) => writtenTest.fileName),
  ];
}


function meaningfulStderr(stderr: string): string | null {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (line.includes("DeprecationWarning")) {
        return false;
      }

      if (line.startsWith("(node:") && line.includes("[DEP")) {
        return false;
      }

      if (line.includes("Use `node --trace-deprecation")) {
        return false;
      }

      return true;
    });

  return lines.length > 0 ? truncate(lines.join("\n")) : null;
}
function extractUsefulPlaywrightFailure(stdout: string): string | null {
  const report = parsePlaywrightReport(stdout);

  if (!report) {
    return firstNonEmpty(stdout);
  }

  const errors: string[] = [];

  for (const suite of report.suites ?? []) {
    collectFailureMessages(suite, errors);
  }

  return errors.length > 0 ? truncate(errors.join("\n\n")) : null;
}

function collectFailureMessages(suite: PlaywrightSuite, errors: string[]): void {
  for (const spec of suite.specs ?? []) {
    for (const testCase of spec.tests ?? []) {
      for (const result of testCase.results ?? []) {
        const error = result.error ?? result.errors?.[0];
        const message = error ? formatError(error) : null;

        if (message) {
          errors.push(`${spec.title ?? "Playwright test"}: ${message}`);
        }
      }
    }
  }

  for (const child of suite.suites ?? []) {
    collectFailureMessages(child, errors);
  }
}

function delimiter(): string {
  return process.platform === "win32" ? ";" : ":";
}

function defaultCommandRunner(
  command: string,
  args: string[],
  options: PlaywrightCommandOptions,
): Promise<PlaywrightCommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
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

        resolve({
          exitCode,
          stdout,
          stderr,
        });
      },
    );
  });
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "test";
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return truncate(trimmed);
    }
  }

  return null;
}

function truncate(value: string, maxLength = 1000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
