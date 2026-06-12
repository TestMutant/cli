import assert from "node:assert/strict";
import test from "node:test";
import {
  runHostedRunner,
  type HostedRunnerAgentGenerator,
  type HostedRunnerResultReporter,
  type HostedRunnerTestExecutor,
} from "../src/hosted-runner";
import type { HostedRunnerConfig } from "../src/hosted-runner-config";
import type {
  HostedRunnerArtifactUploadRequest,
  HostedRunnerHeartbeatResponse,
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

type UploadedArtifact = {
  projectId: string;
  runId: string;
  request: HostedRunnerArtifactUploadRequest;
};

function createHeartbeatResponse(
  overrides: Partial<HostedRunnerHeartbeatResponse> = {},
): HostedRunnerHeartbeatResponse {
  return {
    ok: true,
    organizationId: "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectId: "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    runId: "cccc0000-cccc-cccc-cccc-cccccccccccc",
    hostedRunnerJobId: "11111111-1111-1111-1111-111111111111",
    lastHeartbeatAtUtc: new Date().toISOString(),
    expiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function createMockReporter(options: {
  heartbeat?: (
    projectId: string,
    runId: string,
  ) => Promise<HostedRunnerHeartbeatResponse>;
} = {}): HostedRunnerResultReporter & {
  heartbeats: Array<{ projectId: string; runId: string }>;
  testResults: ReportedTestResult[];
  completions: ReportedCompletion[];
  artifacts: UploadedArtifact[];
} {
  const heartbeats: Array<{ projectId: string; runId: string }> = [];
  const testResults: ReportedTestResult[] = [];
  const completions: ReportedCompletion[] = [];
  const artifacts: UploadedArtifact[] = [];
  const resultIds = new Map<string, string>();
  const validationAttemptIds = new Map<string, string>();
  let resultCounter = 0;
  let artifactCounter = 0;

  return {
    heartbeats,
    testResults,
    completions,
    artifacts,
    async heartbeat(projectId, runId) {
      heartbeats.push({ projectId, runId });
      return options.heartbeat
        ? options.heartbeat(projectId, runId)
        : createHeartbeatResponse({ projectId, runId });
    },
    async reportTestResult(projectId, runId, implementationId, request) {
      testResults.push({ projectId, runId, implementationId, request });

      if (!resultIds.has(implementationId)) {
        resultCounter += 1;
        resultIds.set(implementationId, `result-${resultCounter}`);
        validationAttemptIds.set(implementationId, `attempt-${resultCounter}`);
      }

      return {
        resultId: resultIds.get(implementationId) ?? null,
        validationAttemptId: validationAttemptIds.get(implementationId) ?? null,
      };
    },
    async completeRunResults(projectId, runId, request) {
      completions.push({ projectId, runId, request });
    },
    async uploadArtifact(projectId, runId, request) {
      artifacts.push({ projectId, runId, request });
      artifactCounter += 1;
      return {
        artifactId: `artifact-${artifactCounter}`,
        fileName: request.fileName ?? null,
        contentType: request.contentType ?? null,
      };
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
          traceBuffer: null,
          videoBuffer: null,
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
  assert.ok(result.durationMs >= 0);
  assert.equal(result.artifactsUploaded, 0);

  // Verify per-test result was reported.
  assert.equal(reporter.heartbeats.length, 1);
  assert.equal(reporter.heartbeats[0]!.projectId, "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
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

  // No artifacts uploaded for passing tests.
  assert.equal(reporter.artifacts.length, 0);
});

test("runHostedRunner invokes agent generation for hosted generation runs", async () => {
  const config = buildConfig();
  config.payload.project.runKind = 2;
  const reporter = createMockReporter();

  let capturedOptions: Parameters<HostedRunnerAgentGenerator>[0] | null = null;
  let validationExecutorCalled = false;

  const result = await runHostedRunner(config, {
    resultReporter: reporter,
    heartbeatIntervalMs: 10_000,
    testExecutor: async () => {
      validationExecutorCalled = true;
      throw new Error("validation executor should not be called");
    },
    agentGenerator: async (options) => {
      capturedOptions = options;
      return {
        testImplementationId: "ffff0000-ffff-ffff-ffff-ffffffffffff",
        name: "generated login test",
        sourceLength: 1200,
        attemptCount: 1,
        validationSummary: {
          kind: "playwright",
          baseUrl: "https://staging.example.test",
          total: 1,
          passed: 1,
          failed: 0,
          tests: [],
        },
      };
    },
  });

  assert.equal(validationExecutorCalled, false);
  assert.equal(result.status, "Passed");
  assert.equal(result.totalTests, 1);
  assert.equal(result.passedTests, 1);
  assert.equal(result.failedTests, 0);
  const agentOptions = capturedOptions as Parameters<HostedRunnerAgentGenerator>[0] | null;
  assert.ok(agentOptions);
  assert.equal(agentOptions.apiKey, "session-token");
  assert.equal(agentOptions.runId, "cccc0000-cccc-cccc-cccc-cccccccccccc");
  assert.equal(agentOptions.baseUrl, "https://staging.example.test");
  assert.equal(agentOptions.timeoutMs, 900_000);
  assert.equal(
    agentOptions.webSocketUrl,
    "wss://api.example.test/api/cli/v1/hosted-runner/projects/bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb/runs/cccc0000-cccc-cccc-cccc-cccccccccccc/agent/ws",
  );
});

test("runHostedRunner cancels execution when heartbeat is rejected", async () => {
  const config = buildConfig();
  let sawAbort = false;
  const reporter = createMockReporter({
    async heartbeat() {
      return createHeartbeatResponse({ ok: false });
    },
  });

  const executor: HostedRunnerTestExecutor = async (_tests, options) =>
    new Promise<TestRunSummary>((_resolve, reject) => {
      const abort = () => {
        sawAbort = true;
        reject(new Error("executor aborted"));
      };

      if (options.signal?.aborted) {
        abort();
        return;
      }

      options.signal?.addEventListener("abort", abort, { once: true });
    });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
    heartbeatIntervalMs: 10,
  });

  assert.equal(result.status, "Cancelled");
  assert.equal(sawAbort, true);
  assert.equal(reporter.heartbeats.length, 1);
  assert.equal(reporter.testResults.length, 0);
  assert.equal(reporter.completions.length, 1);
  assert.equal(reporter.completions[0]!.request.status, 4); // Cancelled
  assert.equal(reporter.completions[0]!.request.failedTests, 0);
});

test("runHostedRunner times out execution using the hosted run timeout", async () => {
  const config = buildConfig({
    limits: {
      runTimeoutSeconds: 0.01,
      perTestTimeoutSeconds: 30,
      maxTestsPerRun: 10,
      maxArtifactSizeBytes: 10485760,
      maxRepairAttempts: 1,
    },
  });
  let sawAbort = false;
  const reporter = createMockReporter();

  const executor: HostedRunnerTestExecutor = async (_tests, options) =>
    new Promise<TestRunSummary>((_resolve, reject) => {
      const abort = () => {
        sawAbort = true;
        reject(new Error("executor aborted"));
      };

      if (options.signal?.aborted) {
        abort();
        return;
      }

      options.signal?.addEventListener("abort", abort, { once: true });
    });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.status, "TimedOut");
  assert.equal(sawAbort, true);
  assert.equal(reporter.testResults.length, 0);
  assert.equal(reporter.completions.length, 1);
  assert.equal(reporter.completions[0]!.request.status, 5); // TimedOut
  assert.match(reporter.completions[0]!.request.errorMessage as string, /timed out/i);
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
        traceBuffer: null,
        videoBuffer: null,
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

test("runHostedRunner normalizes repair feedback and hands validation attempts to artifacts", async () => {
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
        screenshotBuffer: Buffer.from("screenshot-data"),
        traceBuffer: Buffer.from("trace-data"),
        videoBuffer: null,
        repairFeedback: {
          consoleLogs: ["stdout: console.error: timeout"],
          browserObservations: ["goto /login", "expect heading to be visible"],
        },
      },
    ],
  });

  await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(reporter.testResults.length, 2);
  assert.equal(reporter.artifacts.length, 2);
  assert.equal(reporter.artifacts[0]!.request.validationAttemptId, "attempt-1");
  assert.equal(reporter.artifacts[1]!.request.validationAttemptId, "attempt-1");

  const outputJson = reporter.testResults[1]!.request.outputJson;
  assert.ok(outputJson);
  assert.deepEqual(JSON.parse(outputJson as string), {
    errorMessage: "Expected heading to be visible",
    screenshotReference: {
      artifactId: "artifact-1",
      validationAttemptId: "attempt-1",
      fileName: "dddd0000-dddd-dddd-dddd-dddddddddddd-screenshot.png",
      contentType: "image/png",
      uploaded: true,
    },
    traceSummary: {
      artifactId: "artifact-2",
      validationAttemptId: "attempt-1",
      fileName: "dddd0000-dddd-dddd-dddd-dddddddddddd-trace.zip",
      contentType: "application/zip",
      uploaded: true,
      summary:
        "Playwright trace uploaded as dddd0000-dddd-dddd-dddd-dddddddddddd-trace.zip.",
    },
    consoleLogs: ["stdout: console.error: timeout"],
    browserObservations: ["goto /login", "expect heading to be visible"],
  });
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
          traceBuffer: null,
          videoBuffer: null,
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
          traceBuffer: null,
          videoBuffer: null,
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
    async heartbeat() {
      return createHeartbeatResponse();
    },
    async reportTestResult() {
      throw new Error("Network error");
    },
    async completeRunResults(projectId, runId, request) {
      completions.push({ projectId, runId, request });
    },
    async uploadArtifact() {
      return { artifactId: null, fileName: null, contentType: null };
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
        traceBuffer: null,
        videoBuffer: null,
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
        traceBuffer: null,
        videoBuffer: null,
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

// ---------------------------------------------------------------------------
// CLI-03: Hosted Validation Execution — per-test timeout enforcement
// ---------------------------------------------------------------------------

test("runHostedRunner passes per-test timeout to executor", async () => {
  const config = buildConfig({
    limits: {
      runTimeoutSeconds: 900,
      perTestTimeoutSeconds: 45,
      maxTestsPerRun: 10,
      maxArtifactSizeBytes: 10485760,
      maxRepairAttempts: 1,
    },
  });
  const reporter = createMockReporter();

  let capturedOptions: unknown;
  const executor: HostedRunnerTestExecutor = async (tests, options) => {
    capturedOptions = options;
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
          traceBuffer: null,
          videoBuffer: null,
        },
      ],
    };
  };

  await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  const options = capturedOptions as {
    baseUrl: string | null;
    perTestTimeoutMs: number;
    traceMode: string;
    videoMode: string;
  };

  assert.equal(options.perTestTimeoutMs, 45_000);
  assert.equal(options.traceMode, "retain-on-failure");
  assert.equal(options.videoMode, "retain-on-failure");
});

// ---------------------------------------------------------------------------
// CLI-03: Hosted Validation Execution — artifact upload for failed tests
// ---------------------------------------------------------------------------

test("runHostedRunner uploads screenshot artifact for failed test", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  const screenshotData = Buffer.from("fake-screenshot-png");

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 1,
    passed: 0,
    failed: 1,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Failed",
        errorMessage: "Element not found",
        durationMs: 500,
        screenshotBuffer: screenshotData,
        traceBuffer: null,
        videoBuffer: null,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.artifactsUploaded, 1);
  assert.equal(reporter.artifacts.length, 1);

  const artifact = reporter.artifacts[0]!;
  assert.equal(artifact.projectId, "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  assert.equal(artifact.runId, "cccc0000-cccc-cccc-cccc-cccccccccccc");
  assert.equal(artifact.request.kind, 1); // Screenshot
  assert.equal(artifact.request.contentType, "image/png");
  assert.ok(artifact.request.fileName!.includes("screenshot.png"));
  assert.equal(artifact.request.contentBase64, screenshotData.toString("base64"));
  assert.equal(artifact.request.runImplementationResultId, "result-1");
});

test("runHostedRunner uploads trace artifact for failed test", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  const traceData = Buffer.from("fake-trace-zip-data");

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 1,
    passed: 0,
    failed: 1,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Failed",
        errorMessage: "Element not found",
        durationMs: 500,
        screenshotBuffer: null,
        traceBuffer: traceData,
        videoBuffer: null,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.artifactsUploaded, 1);
  assert.equal(reporter.artifacts.length, 1);

  const artifact = reporter.artifacts[0]!;
  assert.equal(artifact.request.kind, 2); // Trace
  assert.equal(artifact.request.contentType, "application/zip");
  assert.ok(artifact.request.fileName!.includes("trace.zip"));
  assert.equal(artifact.request.contentBase64, traceData.toString("base64"));
});

test("runHostedRunner uploads video artifact for failed test", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  const videoData = Buffer.from("fake-video-webm-data");

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 1,
    passed: 0,
    failed: 1,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Failed",
        errorMessage: "Element not found",
        durationMs: 500,
        screenshotBuffer: null,
        traceBuffer: null,
        videoBuffer: videoData,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.artifactsUploaded, 1);
  assert.equal(reporter.artifacts.length, 1);

  const artifact = reporter.artifacts[0]!;
  assert.equal(artifact.request.kind, 3); // Video
  assert.equal(artifact.request.contentType, "video/webm");
  assert.ok(artifact.request.fileName!.includes("video.webm"));
  assert.equal(artifact.request.contentBase64, videoData.toString("base64"));
});

test("runHostedRunner uploads all artifact types for failed test", async () => {
  const config = buildConfig();
  const reporter = createMockReporter();

  const screenshotData = Buffer.from("screenshot");
  const traceData = Buffer.from("trace");
  const videoData = Buffer.from("video");

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 1,
    passed: 0,
    failed: 1,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Failed",
        errorMessage: "Element not found",
        durationMs: 500,
        screenshotBuffer: screenshotData,
        traceBuffer: traceData,
        videoBuffer: videoData,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.artifactsUploaded, 3);
  assert.equal(reporter.artifacts.length, 3);

  // All artifacts should reference the same resultId.
  assert.equal(reporter.artifacts[0]!.request.runImplementationResultId, "result-1");
  assert.equal(reporter.artifacts[1]!.request.runImplementationResultId, "result-1");
  assert.equal(reporter.artifacts[2]!.request.runImplementationResultId, "result-1");

  // Verify artifact kinds in order: screenshot, trace, video.
  assert.equal(reporter.artifacts[0]!.request.kind, 1); // Screenshot
  assert.equal(reporter.artifacts[1]!.request.kind, 2); // Trace
  assert.equal(reporter.artifacts[2]!.request.kind, 3); // Video
});

test("runHostedRunner skips artifacts exceeding max size", async () => {
  const config = buildConfig({
    limits: {
      runTimeoutSeconds: 900,
      perTestTimeoutSeconds: 30,
      maxTestsPerRun: 10,
      maxArtifactSizeBytes: 10, // Very small limit
      maxRepairAttempts: 1,
    },
  });
  const reporter = createMockReporter();

  const largeScreenshot = Buffer.alloc(20, "x"); // 20 bytes > 10 byte limit

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 1,
    passed: 0,
    failed: 1,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Failed",
        errorMessage: "Element not found",
        durationMs: 500,
        screenshotBuffer: largeScreenshot,
        traceBuffer: null,
        videoBuffer: null,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.artifactsUploaded, 0);
  assert.equal(reporter.artifacts.length, 0);
});

test("runHostedRunner artifact upload failure does not fail the run", async () => {
  const config = buildConfig();
  const completions: ReportedCompletion[] = [];

  const reporter: HostedRunnerResultReporter = {
    async heartbeat() {
      return createHeartbeatResponse();
    },
    async reportTestResult() {
      return { resultId: "result-1", validationAttemptId: "attempt-1" };
    },
    async completeRunResults(projectId, runId, request) {
      completions.push({ projectId, runId, request });
    },
    async uploadArtifact() {
      throw new Error("Upload failed");
    },
  };

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 1,
    passed: 0,
    failed: 1,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Failed",
        errorMessage: "Element not found",
        durationMs: 500,
        screenshotBuffer: Buffer.from("screenshot"),
        traceBuffer: Buffer.from("trace"),
        videoBuffer: null,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  // Run should complete despite upload failures.
  assert.equal(result.status, "Failed");
  assert.equal(result.artifactsUploaded, 0);
  assert.equal(completions.length, 1);
});

// ---------------------------------------------------------------------------
// CLI-03: Run timing
// ---------------------------------------------------------------------------

test("runHostedRunner reports run timing in completion request", async () => {
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
        traceBuffer: null,
        videoBuffer: null,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.ok(result.durationMs >= 0);

  // Verify completion request includes timing.
  const completion = reporter.completions[0]!.request;
  assert.ok(completion.durationMs !== undefined);
  assert.ok(typeof completion.durationMs === "number");
  assert.ok(completion.startedAtUtc !== undefined);
  assert.ok(completion.completedAtUtc !== undefined);
});

test("runHostedRunner does not upload artifacts for passing tests", async () => {
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
        traceBuffer: null,
        videoBuffer: null,
      },
    ],
  });

  await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  // Passing tests should not have artifacts (screenshot/trace/video are only on failure).
  assert.equal(reporter.artifacts.length, 0);
});

test("runHostedRunner uploads artifacts for multiple failed tests with correct result IDs", async () => {
  const config = buildConfig();
  config.payload.testSource.tests.push({
    implementationId: "eeee0000-eeee-eeee-eeee-eeeeeeeeeeee",
    testSpecId: "ffff0000-ffff-ffff-ffff-ffffffffffff",
    requirementId: null,
    specTitle: "Dashboard loads",
    testLayer: "EndToEnd",
    runnerKind: "playwright",
    name: "dashboard loads",
    description: null,
    source: 'import { test } from "@playwright/test";\ntest("dashboard", async ({ page }) => {});',
    targetPath: null,
    status: 0,
    lifecycleStatus: 0,
    implementationSource: 0,
  });

  const reporter = createMockReporter();

  const executor: HostedRunnerTestExecutor = async () => ({
    kind: "playwright",
    baseUrl: null,
    total: 2,
    passed: 0,
    failed: 2,
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        runnerKind: "playwright",
        name: "login page loads",
        status: "Failed",
        errorMessage: "Login failed",
        durationMs: 500,
        screenshotBuffer: Buffer.from("login-screenshot"),
        traceBuffer: null,
        videoBuffer: null,
      },
      {
        implementationId: "eeee0000-eeee-eeee-eeee-eeeeeeeeeeee",
        runnerKind: "playwright",
        name: "dashboard loads",
        status: "Failed",
        errorMessage: "Dashboard timeout",
        durationMs: 600,
        screenshotBuffer: Buffer.from("dashboard-screenshot"),
        traceBuffer: Buffer.from("dashboard-trace"),
        videoBuffer: null,
      },
    ],
  });

  const result = await runHostedRunner(config, {
    testExecutor: executor,
    resultReporter: reporter,
  });

  assert.equal(result.artifactsUploaded, 3); // 1 screenshot + 1 screenshot + 1 trace

  // First test: 1 screenshot linked to result-1.
  assert.equal(reporter.artifacts[0]!.request.runImplementationResultId, "result-1");
  assert.equal(reporter.artifacts[0]!.request.kind, 1);

  // Second test: 1 screenshot + 1 trace linked to result-2.
  assert.equal(reporter.artifacts[1]!.request.runImplementationResultId, "result-2");
  assert.equal(reporter.artifacts[1]!.request.kind, 1);
  assert.equal(reporter.artifacts[2]!.request.runImplementationResultId, "result-2");
  assert.equal(reporter.artifacts[2]!.request.kind, 2);
});
