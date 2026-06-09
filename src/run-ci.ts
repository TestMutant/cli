import { TestMutantApiClient, type CliRunTest } from "./api-client";
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
import type { AgentGenerationResult } from "./agent-runner";

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
  baseUrl?: string | null;
}) => Promise<AgentGenerationResult>;

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
  const shouldGenerate = isGenerateMode(createRunRequest.mode);
if (shouldGenerate) {
    const agentGenerator = options.agentGenerator ?? (await getDefaultAgentGenerator());

    const generationResult = await executeAgentGenerationForApiCompletion(
        agentGenerator,
        {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        userAgent: options.userAgent,
        runId: created.runId,
        baseUrl: createRunRequest.baseUrl,
        },
    );

    if (!generationResult.ok) {
      if (isEnforceMode(createRunRequest.mode)) {
        throw new CliError(
          `TestMutant test generation failed: ${generationResult.errorMessage}`,
          1,
        );
      }

      return {
        runId: created.runId,
        status: "Failed",
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        tests: [],
        baseUrl: createRunRequest.baseUrl ?? null,
      };
    }

    const validationSummary = generationResult.result.validationSummary;
    return {
      runId: created.runId,
      status: "Passed",
      totalTests: validationSummary?.total ?? 0,
      passedTests: validationSummary?.passed ?? 0,
      failedTests: validationSummary?.failed ?? 0,
      tests: validationSummary?.tests,
      baseUrl: validationSummary?.baseUrl ?? createRunRequest.baseUrl ?? null,
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
function isGenerateMode(mode: string | null | undefined): boolean {
  const normalized = mode?.trim().toLowerCase();
  return normalized === "generate" || normalized === "author";
}

async function getDefaultAgentGenerator(): Promise<RunCiAgentGenerator> {
  const module = await import("./agent-runner");
  return module.runAgentGeneration;
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
): Promise<
  | { ok: true; result: AgentGenerationResult }
  | { ok: false; errorMessage: string }
> {
  try {
    return {
      ok: true,
      result: await agentGenerator(options),
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
