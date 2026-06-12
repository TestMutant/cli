import type { HostedRunnerConfig, HostedRunnerTestDefinition } from "./hosted-runner-config";
import {
  HostedRunnerApiClient,
  type CliRunImplementation,
  type HostedRunnerCompleteRunResultRequest,
  type HostedRunnerTestResultRequest,
} from "./api-client";
import {
  runPlaywrightTests,
  type PlaywrightExecutionOptions,
  type TestRunSummary,
} from "./playwright-runner";

// RunImplementationResultStatus enum values (from API contract).
const ResultStatus = {
  Passed: 0,
  Failed: 1,
  Skipped: 2,
} as const;

// RunStatus enum values (from API contract).
const RunStatus = {
  Created: 0,
  Running: 1,
  Completed: 2,
  Failed: 3,
  Cancelled: 4,
  TimedOut: 5,
} as const;

export type HostedRunnerResult = {
  runId: string;
  projectId: string;
  status: "Passed" | "Failed";
  totalTests: number;
  passedTests: number;
  failedTests: number;
};

export type HostedRunnerTestExecutor = (
  tests: CliRunImplementation[],
  options: PlaywrightExecutionOptions,
) => Promise<TestRunSummary>;

export type HostedRunnerResultReporter = {
  reportTestResult(
    projectId: string,
    runId: string,
    implementationId: string,
    request: HostedRunnerTestResultRequest,
  ): Promise<void>;
  completeRunResults(
    projectId: string,
    runId: string,
    request: HostedRunnerCompleteRunResultRequest,
  ): Promise<void>;
};

export type HostedRunnerOptions = {
  testExecutor?: HostedRunnerTestExecutor;
  resultReporter?: HostedRunnerResultReporter;
};

/**
 * Executes a hosted runner job using the API-provided configuration.
 *
 * 1. Converts payload test definitions to CliRunImplementation format.
 * 2. Executes tests via the Playwright runner.
 * 3. Reports per-test results to the API (best-effort).
 * 4. Completes the run with aggregate results.
 */
export async function runHostedRunner(
  config: HostedRunnerConfig,
  options: HostedRunnerOptions = {},
): Promise<HostedRunnerResult> {
  const testDefinitions = config.payload.testSource?.tests ?? [];
  const implementations = testDefinitions.map(toCliRunImplementation);

  const baseUrl =
    config.payload.project?.baseUrl ??
    config.payload.environment?.baseUrl ??
    null;

  const perTestTimeoutMs = config.limits.perTestTimeoutSeconds * 1000;
  const testExecutor = options.testExecutor ?? runPlaywrightTests;
  const resultReporter = options.resultReporter ?? createDefaultResultReporter(config);

  const testSummary = await executeTests(testExecutor, implementations, baseUrl, perTestTimeoutMs);

  // Report per-test results back to the API (best-effort, don't fail the run on reporting errors).
  for (const test of testSummary.tests) {
    const resultStatus =
      test.status === "Passed" ? ResultStatus.Passed : ResultStatus.Failed;

    await resultReporter
      .reportTestResult(config.projectId, config.runId, test.implementationId, {
        status: resultStatus,
        durationMs: test.durationMs,
        errorMessage: test.errorMessage,
        environmentUrl: baseUrl,
      })
      .catch(() => {});
  }

  // Complete the run with aggregate results.
  const passed = testSummary.failed === 0 && testSummary.total > 0;
  const runStatus = passed ? RunStatus.Completed : RunStatus.Failed;

  await resultReporter.completeRunResults(config.projectId, config.runId, {
    status: runStatus,
    summary:
      testSummary.total === 0
        ? "No tests were provided for execution."
        : `Executed ${testSummary.total} test${testSummary.total === 1 ? "" : "s"}: ${testSummary.passed} passed, ${testSummary.failed} failed.`,
    errorMessage: passed
      ? null
      : testSummary.total === 0
        ? "No tests were provided for execution."
        : `${testSummary.failed} test${testSummary.failed === 1 ? "" : "s"} failed.`,
    totalTests: testSummary.total,
    passedTests: testSummary.passed,
    failedTests: testSummary.failed,
    environmentUrl: baseUrl,
  });

  return {
    runId: config.runId,
    projectId: config.projectId,
    status: passed ? "Passed" : "Failed",
    totalTests: testSummary.total,
    passedTests: testSummary.passed,
    failedTests: testSummary.failed,
  };
}

function toCliRunImplementation(
  test: HostedRunnerTestDefinition,
): CliRunImplementation {
  return {
    implementationId: test.implementationId,
    testSpecId: test.testSpecId,
    testLayer: test.testLayer,
    runnerKind: test.runnerKind,
    name: test.name,
    source: test.source,
  };
}

async function executeTests(
  testExecutor: HostedRunnerTestExecutor,
  implementations: CliRunImplementation[],
  baseUrl: string | null,
  _perTestTimeoutMs: number,
): Promise<TestRunSummary> {
  if (implementations.length === 0) {
    return {
      kind: "playwright",
      baseUrl,
      total: 0,
      passed: 0,
      failed: 0,
      tests: [],
    };
  }

  try {
    return await testExecutor(implementations, { baseUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      kind: "playwright",
      baseUrl,
      total: implementations.length,
      passed: 0,
      failed: implementations.length,
      tests: implementations.map((impl) => ({
        implementationId: impl.implementationId,
        runnerKind: impl.runnerKind,
        name: impl.name,
        status: "Failed" as const,
        errorMessage: message,
        durationMs: null,
        screenshotBuffer: null,
      })),
    };
  }
}

function createDefaultResultReporter(
  config: HostedRunnerConfig,
): HostedRunnerResultReporter {
  const client = new HostedRunnerApiClient({
    apiUrl: config.apiUrl,
    sessionToken: config.sessionToken,
    timeoutMs: 30_000,
  });

  return {
    async reportTestResult(projectId, runId, implementationId, request) {
      await client.reportTestResult(projectId, runId, implementationId, request);
    },
    async completeRunResults(projectId, runId, request) {
      await client.completeRunResults(projectId, runId, request);
    },
  };
}
