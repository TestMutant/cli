import { TestMutantApiClient, type CliRunTest } from "./api-client";
import { runAgentGeneration } from "./agent-runner";
import { buildCreateRunRequest } from "./ci-metadata";
import {
  API_KEY_ENV_VAR,
  API_URL_ENV_VAR,
  CliError,
  DEFAULT_API_URL,
  resolveConfig,
} from "./config";
import {
  runPlaywrightTests,
  type PlaywrightExecutionOptions,
  type TestRunSummary,
  type TestRunResult
} from "./playwright-runner";

export type RunCiOptions = {
  apiKey?: string;
  apiUrl?: string;
  timeout?: string;

  mode?: string;
  repository?: string;
  provider?: string;
  baseUrl?: string;
  environmentName?: string;

  userAgent: string;
  agentGenerator?: RunCiAgentGenerator;
  testExecutor?: RunCiTestExecutor;
};

export type RunCiResult = {
  runId: string;
  status: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  tests?: TestRunResult[];
  baseUrl?: string | null;
};

export type RunCiTestExecutor = (
  tests: Parameters<typeof runPlaywrightTests>[0],
  options: PlaywrightExecutionOptions,
) => Promise<TestRunSummary>;

export type RunCiAgentGenerator = (options: {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
  userAgent: string;
  runId: string;
}) => Promise<void>;

export async function runCi(options: RunCiOptions): Promise<RunCiResult> {
  applyOptionEnvironmentOverrides(options);

  const config = resolveConfig({
    apiKey: options.apiKey,
    apiUrl: options.apiUrl,
    timeout: options.timeout,
  });

  const client = new TestMutantApiClient({
    ...config,
    userAgent: options.userAgent,
  });

  const createRunRequest = buildCreateRunRequest({
    mode: options.mode,
    repositoryProvider: options.provider,
    repositoryFullName: options.repository,
    baseUrl: options.baseUrl,
    environmentName: options.environmentName,
  });

  const created = await client.createRun(createRunRequest);
  const runTests = created.tests ?? [];
  const agentGenerator = options.agentGenerator ?? runAgentGeneration;
  const generationError = await executeAgentGenerationForApiCompletion(
    agentGenerator,
    {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      userAgent: options.userAgent,
      runId: created.runId,
    },
  );

  if (generationError) {
    const testSummary = summarizeGenerationFailure(
      runTests,
      createRunRequest.baseUrl,
      generationError,
    );
    const completed = await client.completeRun(created.runId, {
      status: "Failed",
      summary: "Test generation failed.",
      results: {
        ...testSummary,
        repositoryFullName: createRunRequest.repositoryFullName,
        branch: createRunRequest.branch,
        commitSha: createRunRequest.commitSha,
        ciProvider: createRunRequest.ciProvider,
        ciRunId: createRunRequest.ciRunId,
        generatedAtUtc: new Date().toISOString(),
      },
      resultJson: null,
      errorMessage: generationError,
    });

    if (isEnforceMode(createRunRequest.mode)) {
      throw new CliError(`TestMutant test generation failed: ${generationError}`, 1);
    }

    return {
      runId: completed.runId,
      status: completed.status,
      totalTests: testSummary.total,
      passedTests: testSummary.passed,
      failedTests: testSummary.failed,
      tests: testSummary.tests,
      baseUrl: testSummary.baseUrl,
    };
  }

  const testExecutor = options.testExecutor ?? runPlaywrightTests;
  const testSummary = await executeTestsForApiCompletion(
    testExecutor,
    runTests,
    createRunRequest.baseUrl,
  );
  const passed = testSummary.failed === 0;

  const completed = await client.completeRun(created.runId, {
    status: passed ? "Passed" : "Failed",
    summary:
      testSummary.total === 0
        ? "CI metadata captured. No tests were returned for this run."
        : `Executed ${testSummary.total} Playwright test${testSummary.total === 1 ? "" : "s"}: ${testSummary.passed} passed, ${testSummary.failed} failed.`,
    results: {
      ...testSummary,
      repositoryFullName: createRunRequest.repositoryFullName,
      branch: createRunRequest.branch,
      commitSha: createRunRequest.commitSha,
      ciProvider: createRunRequest.ciProvider,
      ciRunId: createRunRequest.ciRunId,
      generatedAtUtc: new Date().toISOString(),
    },
    resultJson: null,
    errorMessage: passed ? null : `${testSummary.failed} Playwright test failed.`,
  });

  if (!passed && isEnforceMode(createRunRequest.mode)) {
    throw new CliError(
      `TestMutant run failed: ${testSummary.failed} of ${testSummary.total} Playwright tests failed.`,
      1,
    );
  }

  return {
    runId: completed.runId,
    status: completed.status,
    totalTests: testSummary.total,
    passedTests: testSummary.passed,
    failedTests: testSummary.failed,
    tests: testSummary.tests,
    baseUrl: testSummary.baseUrl,
  };
}

function applyOptionEnvironmentOverrides(options: RunCiOptions): void {
  if (options.apiKey) {
    process.env[API_KEY_ENV_VAR] = options.apiKey;
  }

  if (options.apiUrl) {
    process.env[API_URL_ENV_VAR] = options.apiUrl;
  }

  if (!process.env[API_URL_ENV_VAR]) {
    process.env[API_URL_ENV_VAR] = DEFAULT_API_URL;
  }
}

function isEnforceMode(mode: string | null | undefined): boolean {
  return mode?.trim().toLowerCase() === "enforce";
}

async function executeTestsForApiCompletion(
  testExecutor: RunCiTestExecutor,
  tests: CliRunTest[],
  baseUrl: string | null,
): Promise<TestRunSummary> {
  try {
    return await testExecutor(tests, { baseUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      kind: "playwright",
      baseUrl,
      total: tests.length,
      passed: 0,
      failed: tests.length,
      tests: tests.map((test) => ({
        testId: test.testId,
        type: test.type,
        name: test.name,
        status: "Failed",
        errorMessage: message,
        durationMs: null,
      })),
    };
  }
}

async function executeAgentGenerationForApiCompletion(
  agentGenerator: RunCiAgentGenerator,
  options: Parameters<RunCiAgentGenerator>[0],
): Promise<string | null> {
  try {
    await agentGenerator(options);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function summarizeGenerationFailure(
  tests: CliRunTest[],
  baseUrl: string | null,
  errorMessage: string,
): TestRunSummary {
  const results = tests.map<TestRunResult>((test) => ({
    testId: test.testId,
    type: test.type,
    name: test.name,
    status: "Failed",
    errorMessage,
    durationMs: null,
  }));

  return {
    kind: "playwright",
    baseUrl,
    total: results.length,
    passed: 0,
    failed: results.length,
    tests: results,
  };
}
