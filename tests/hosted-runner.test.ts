import assert from "node:assert/strict";
import test from "node:test";
import {
  runHostedRunner,
  type HostedRunnerResultReporter,
  type HostedRunnerTestExecutor,
} from "../src/hosted-runner";
import type { HostedRunnerConfig } from "../src/hosted-runner-config";
import type {
  HostedRunnerTestResultRequest,
  HostedRunnerCompleteRunResultRequest,
} from "../src/api-client";
import type { TestRunSummary } from "../src/playwright-runner";

function buildConfig(
  overrides: Partial<HostedRunnerConfig> = {},
): HostedRunnerConfig {
  return {
    hostedRunnerJobId: "11111111-1111-1111-1111-111111111111",
    organizationId: "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectId: "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    runId: "cccc0000-cccc-cccc-cccc-cccccccccccc",
    sessionToken: "session-token",
    apiUrl: "https://api.example.test",
    environmentConfigurationId: null,
    payload: {
      project: {
        organizationId: "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        organizationName: "Acme",
        projectId: "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        projectName: "WebApp",
        runId: "cccc0000-cccc-cccc-cccc-cccccccccccc",
        runKind: 0,
        repositoryFullName: null,
        baseUrl: "https://staging.example.test",
        environmentName: "Staging",
      },
      environment: null,
      testSource: {
        sourceKind: "Inline",
        tests: [
          {
            implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
            testSpecId: "eeee0000-eeee-eeee-eeee-eeeeeeeeeeee",
            requirementId: null,
            specTitle: "Login page loads",
            testLayer: "EndToEnd",
            runnerKind: "playwright",
            name: "login page loads",
            description: null,
            source: 'import { test } from "@playwright/test";\ntest("login", async ({ page }) => {});',
            targetPath: null,
            status: 0,
            lifecycleStatus: 0,
            implementationSource: 0,
          },
        ],
      },
      limits: {
        runTimeoutSeconds: 900,
        perTestTimeoutSeconds: 30,
        maxTestsPerRun: 10,
        maxArtifactSizeBytes: 10485760,
        maxRepairAttempts: 1,
      },
      artifactUploads: {
        maxArtifactSizeBytes: 10485760,
        callbackBasePath: "/api/cli/v1/hosted-runner/projects/bbbb0000/runs/cccc0000",
        heartbeatPath: "/api/cli/v1/hosted-runner/projects/bbbb0000/runs/cccc0000/heartbeat",
        screenshotPathTemplate: "/api/cli/v1/runs/cccc0000/results/{implementationId}/screenshot",
      },
    },
    limits: {
      runTimeoutSeconds: 900,
      perTestTimeoutSeconds: 30,
      maxTestsPerRun: 10,
      maxArtifactSizeBytes: 10485760,
      maxRepairAttempts: 1,
    },
    ...overrides,
  };
}

type ReportedTestResult = {
  projectId: string;
  runId: string;
  implementationId: string;
  request: HostedRunnerTestResultRequest;
};

type ReportedCompletion = {
  projectId: string;
  runId: string;
  request: HostedRunnerCompleteRunResultRequest;
};

function createMockReporter(): HostedRunnerResultReporter & {
  testResults: ReportedTestResult[];
  completions: ReportedCompletion[];
} {
  const testResults: ReportedTestResult[] = [];
  const completions: ReportedCompletion[] = [];

  return {
    testResults,
    completions,
    async reportTestResult(projectId, runId, implementationId, request) {
      testResults.push({ projectId, runId, implementationId, request });
    },
    async completeRunResults(projectId, runId, request) {
      completions.push({ projectId, runId, request });
    },
  };
}

test("runHostedRunner executes tests and reports passing results", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  const executor: HostedRunnerTestExecutor = async (tests, options) => {
    assert.equal(tests.length, 1);
    assert.equal(tests[0]!.implementationId, "dddd0000-dddd-dddd-dddd-dddddddddddd");
    assert.equal(tests[0]!.runnerKind, "playwright");
    assert.equal(options.baseUrl, "https://staging.example.test");

    return {
      kind: "playwright",
      baseUrl: "https://staging.example.test",
      total: 1,
      passed: 1,
      failed: 0,
      tests: [
        {
          implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
          runnerKind: "playwright",
          name: "login page loads",
          status: "Passed",
          errorMessage: null,
          durationMs: 250,
          screenshotBuffer: null,
        },
      ],
    };
  };

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.status, "Passed");
  assert.equal(result.totalTests, 1);
  assert.equal(result.passedTests, 1);
  assert.equal(result.failedTests, 0);
  assert.equal(result.runId, "cccc0000-cccc-cccc-cccc-cccccccccccc");
  assert.equal(result.projectId, "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

  // Verify per-test result was reported.
  assert.equal(reporter.testResults.length, 1);
  assert.equal(reporter.testResults[0]!.implementationId, "dddd0000-dddd-dddd-dddd-dddddddddddd");
  assert.equal(reporter.testResults[0]!.request.status, 0); // Passed
  assert.equal(reporter.testResults[0]!.request.durationMs, 250);

  // Verify run was completed.
  assert.equal(reporter.completions.length, 1);
  assert.equal(reporter.completions[0]!.request.status, 2); // Completed
  assert.equal(reporter.completions[0]!.request.totalTests, 1);
  assert.equal(reporter.completions[0]!.request.passedTests, 1);
  assert.equal(reporter.completions[0]!.request.failedTests, 0);
  assert.ok((reporter.completions[0]!.request.summary as string).includes("1 passed"));
});

test("runHostedRunner reports failure when tests fail", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: "https://staging.example.test",
    total: 1,
    passed: 0,
    failed: 1,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Failed",
        errorMessage: "Expected heading to be visible",
        durationMs: 500,
        screenshotBuffer: null,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.status, "Failed");
  assert.equal(result.totalTests, 1);
  assert.equal(result.passedTests, 0);
  assert.equal(result.failedTests, 1);

  // Verify per-test failure was reported.
  assert.equal(reporter.testResults[0]!.request.status, 1); // Failed
  assert.equal(reporter.testResults[0]!.request.errorMessage, "Expected heading to be visible");

  // Verify run was completed as Failed.
  assert.equal(reporter.completions[0]!.request.status, 3); // Failed
  assert.ok((reporter.completions[0]!.request.errorMessage as string).includes("1 test failed"));
});

test("runHostedRunner handles executor crash gracefully", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  const executor: HostedRunnerTestExecutor = async () => {
    throw new Error("Playwright runtime is unavailable");
  };

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.status, "Failed");
  assert.equal(result.totalTests, 1);
  assert.equal(result.passedTests, 0);
  assert.equal(result.failedTests, 1);

  // Verify failure was reported.
  assert.equal(reporter.testResults[0]!.request.status, 1); // Failed
  assert.equal(reporter.completions[0]!.request.status, 3); // Failed
});

test("runHostedRunner handles zero tests", async () => {
  const config = buildConfig();
  // Override to have no tests.
  config.payload.testSource.tests = [];
  const reporter = createMockReporter();

  const executor: HostedRunnerTestExecutor = async () => {
    throw new Error("should not be called");
  };

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.status, "Failed");
  assert.equal(result.totalTests, 0);
  assert.equal(result.passedTests, 0);
  assert.equal(result.failedTests, 0);

  // Verify no per-test results reported.
  assert.equal(reporter.testResults.length, 0);

  // Verify run was completed.
  assert.equal(reporter.completions.length, 1);
  assert.equal(reporter.completions[0]!.request.status, 3); // Failed (no tests = failure)
  assert.ok((reporter.completions[0]!.request.summary as string).includes("No tests"));
});

test("runHostedRunner uses environment baseUrl when project baseUrl is null", async () => {
  const config = buildConfig();
  config.payload.project.baseUrl = null;
  config.payload = {
    ...config.payload,
    environment: {
      environmentConfigurationId: "ffff0000-ffff-ffff-ffff-ffffffffffff",
      name: "Staging",
      baseUrl: "https://env.example.test",
      timeZoneId: "UTC",
      testDataNotes: null,
      requiresPassingEnvironmentCheck: false,
      environmentCheckSkippedAtUtc: null,
      auth: {
        authMode: 0,
        loginUrl: null,
        loginInstructions: null,
        postLoginVerificationHint: null,
        credentialPreview: null,
        hasCredentials: false,
        username: null,
        password: null,
      },
    },
  };
  const reporter = createMockReporter();

  let capturedBaseUrl: string | null | undefined;
  const executor: HostedRunnerTestExecutor = async (tests, options) => {
    capturedBaseUrl = options.baseUrl;
    return {
      kind: "playwright",
      baseUrl: options.baseUrl ?? null,
      total: 1,
      passed: 1,
      failed: 0,
      tests: [
        {
          implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
          runnerKind: "playwright",
          name: "login page loads",
          status: "Passed",
          errorMessage: null,
          durationMs: 100,
          screenshotBuffer: null,
        },
      ],
    };
  };

  await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(capturedBaseUrl, "https://env.example.test");
});

test("runHostedRunner converts payload test definitions to CliRunImplementation format", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  let capturedTests: unknown;
  const executor: HostedRunnerTestExecutor = async (tests) => {
    capturedTests = tests;
    return {
      kind: "playwright",
      baseUrl: null,
      total: 1,
      passed: 1,
      failed: 0,
      tests: [
        {
          implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
          runnerKind: "playwright",
          name: "login page loads",
          status: "Passed",
          errorMessage: null,
          durationMs: 100,
          screenshotBuffer: null,
        },
      ],
    };
  };

  await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  const tests = capturedTests as Array<{
    implementationId: string;
    testSpecId: string;
    testLayer: string;
    runnerKind: string;
    name: string;
    source: string;
  }>;

  assert.equal(tests.length, 1);
  assert.equal(tests[0]!.implementationId, "dddd0000-dddd-dddd-dddd-dddddddddddd");
  assert.equal(tests[0]!.testSpecId, "eeee0000-eeee-eeee-eeee-eeeeeeeeeeee");
  assert.equal(tests[0]!.testLayer, "EndToEnd");
  assert.equal(tests[0]!.runnerKind, "playwright");
  assert.equal(tests[0]!.name, "login page loads");
  assert.ok(tests[0]!.source.includes("@playwright/test"));
});

test("runHostedRunner per-test reporting failure does not prevent run completion", async () => {
  const config = buildConfig();
  const completions: ReportedCompletion[] = [];

  const failingReporter: HostedRunnerResultReporter = {
    async reportTestResult() {
      throw new Error("Network error");
    },
    async completeRunResults(projectId, runId, request) {
      completions.push({ projectId, runId, request });
    },
  };

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 1,
    passed: 1,
    failed: 0,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Passed",
        errorMessage: null,
        durationMs: 100,
        screenshotBuffer: null,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: failingReporter,
  });

  // Run should still complete despite per-test reporting failure.
  assert.equal(result.status, "Passed");
  assert.equal(completions.length, 1);
  assert.equal(completions[0]!.request.status, 2); // Completed
});

test("runHostedRunner passes correct project and run IDs to reporter", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 1,
    passed: 1,
    failed: 0,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Passed",
        errorMessage: null,
        durationMs: 100,
        screenshotBuffer: null,
      },
    ],
  });

  await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(reporter.testResults[0]!.projectId, "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  assert.equal(reporter.testResults[0]!.runId, "cccc0000-cccc-cccc-cccc-cccccccccccc");
  assert.equal(reporter.completions[0]!.projectId, "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  assert.equal(reporter.completions[0]!.runId, "cccc0000-cccc-cccc-cccc-cccccccccccc");
});
