import type { HostedRunnerConfig, HostedRunnerTestDefinition } from "./hosted-runner-config";
import {
  HostedRunnerApiClient,
  type CliRunImplementation,
  type HostedRunnerArtifactUploadRequest,
  type HostedRunnerCompleteRunResultRequest,
  type HostedRunnerTestResultRequest,
} from "./api-client";
import {
  runPlaywrightTests,
  type PlaywrightExecutionOptions,
  type TestRunResult,
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

// TestArtifactKind enum values (from API contract).
const ArtifactKind = {
  Screenshot: 1,
  Trace: 2,
  Video: 3,
  Log: 4,
  Console: 5,
  NetworkSummary: 6,
} as const;

export type HostedRunnerResult = {
  runId: string;
  projectId: string;
  status: "Passed" | "Failed";
  totalTests: number;
  passedTests: number;
  failedTests: number;
  durationMs: number;
  artifactsUploaded: number;
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
  ): Promise<{ resultId: string | null }>;
  completeRunResults(
    projectId: string,
    runId: string,
    request: HostedRunnerCompleteRunResultRequest,
  ): Promise<void>;
  uploadArtifact(
    projectId: string,
    runId: string,
    request: HostedRunnerArtifactUploadRequest,
  ): Promise<{ artifactId: string | null }>;
};

export type HostedRunnerOptions = {
  testExecutor?: HostedRunnerTestExecutor;
  resultReporter?: HostedRunnerResultReporter;
};

/**
 * Executes a hosted runner job using the API-provided configuration.
 *
 * 1. Converts payload test definitions to CliRunImplementation format.
 * 2. Executes tests via the Playwright runner with workers=1 and per-test timeout.
 * 3. Reports per-test results and uploads artifacts to the API (best-effort).
 * 4. Completes the run with aggregate results including timing and artifact counts.
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
  const maxArtifactSizeBytes = config.limits.maxArtifactSizeBytes;
  const testExecutor = options.testExecutor ?? runPlaywrightTests;
  const resultReporter = options.resultReporter ?? createDefaultResultReporter(config);

  const startedAtUtc = new Date().toISOString();
  const testSummary = await executeTests(testExecutor, implementations, {
    baseUrl,
    perTestTimeoutMs,
    traceMode: "retain-on-failure",
    videoMode: "retain-on-failure",
  });
  const completedAtUtc = new Date().toISOString();
  const durationMs = new Date(completedAtUtc).getTime() - new Date(startedAtUtc).getTime();

  // Report per-test results and upload artifacts (best-effort).
  let artifactsUploaded = 0;

  for (const test of testSummary.tests) {
    const resultStatus =
      test.status === "Passed" ? ResultStatus.Passed : ResultStatus.Failed;

    const { resultId } = await resultReporter
      .reportTestResult(config.projectId, config.runId, test.implementationId, {
        status: resultStatus,
        durationMs: test.durationMs,
        errorMessage: test.errorMessage,
        environmentUrl: baseUrl,
        startedAtUtc,
        completedAtUtc,
      })
      .catch(() => ({ resultId: null }));

    // Upload artifacts for this test result (best-effort).
    artifactsUploaded += await uploadTestArtifacts(
      resultReporter,
      config.projectId,
      config.runId,
      resultId,
      test,
      maxArtifactSizeBytes,
    );
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
    durationMs,
    environmentUrl: baseUrl,
    startedAtUtc,
    completedAtUtc,
  });

  return {
    runId: config.runId,
    projectId: config.projectId,
    status: passed ? "Passed" : "Failed",
    totalTests: testSummary.total,
    passedTests: testSummary.passed,
    failedTests: testSummary.failed,
    durationMs,
    artifactsUploaded,
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

type ExecutionOptions = {
  baseUrl: string | null;
  perTestTimeoutMs: number;
  traceMode: "off" | "retain-on-failure";
  videoMode: "off" | "retain-on-failure";
};

async function executeTests(
  testExecutor: HostedRunnerTestExecutor,
  implementations: CliRunImplementation[],
  options: ExecutionOptions,
): Promise<TestRunSummary> {
  if (implementations.length === 0) {
    return {
      kind: "playwright",
      baseUrl: options.baseUrl,
      total: 0,
      passed: 0,
      failed: 0,
      tests: [],
    };
  }

  try {
    return await testExecutor(implementations, {
      baseUrl: options.baseUrl,
      perTestTimeoutMs: options.perTestTimeoutMs,
      traceMode: options.traceMode,
      videoMode: options.videoMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      kind: "playwright",
      baseUrl: options.baseUrl,
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
        traceBuffer: null,
        videoBuffer: null,
      })),
    };
  }
}

/**
 * Uploads screenshot, trace, and video artifacts for a single test result.
 * Each upload is best-effort; failures are silently ignored.
 * Artifacts exceeding the max size limit are skipped.
 * Returns the count of successfully uploaded artifacts.
 */
async function uploadTestArtifacts(
  reporter: HostedRunnerResultReporter,
  projectId: string,
  runId: string,
  resultId: string | null,
  test: TestRunResult,
  maxArtifactSizeBytes: number,
): Promise<number> {
  const artifacts: Array<{
    kind: number;
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }> = [];

  if (test.screenshotBuffer) {
    artifacts.push({
      kind: ArtifactKind.Screenshot,
      fileName: `${safeFilePart(test.implementationId)}-screenshot.png`,
      contentType: "image/png",
      buffer: test.screenshotBuffer,
    });
  }

  if (test.traceBuffer) {
    artifacts.push({
      kind: ArtifactKind.Trace,
      fileName: `${safeFilePart(test.implementationId)}-trace.zip`,
      contentType: "application/zip",
      buffer: test.traceBuffer,
    });
  }

  if (test.videoBuffer) {
    artifacts.push({
      kind: ArtifactKind.Video,
      fileName: `${safeFilePart(test.implementationId)}-video.webm`,
      contentType: "video/webm",
      buffer: test.videoBuffer,
    });
  }

  let uploaded = 0;

  for (const artifact of artifacts) {
    if (artifact.buffer.byteLength > maxArtifactSizeBytes) {
      continue;
    }

    const { artifactId } = await reporter
      .uploadArtifact(projectId, runId, {
        kind: artifact.kind,
        fileName: artifact.fileName,
        contentType: artifact.contentType,
        contentBase64: artifact.buffer.toString("base64"),
        runImplementationResultId: resultId,
      })
      .catch(() => ({ artifactId: null }));

    if (artifactId) {
      uploaded += 1;
    }
  }

  return uploaded;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "test";
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
      const response = await client.reportTestResult(projectId, runId, implementationId, request);
      return { resultId: response.resultId };
    },
    async completeRunResults(projectId, runId, request) {
      await client.completeRunResults(projectId, runId, request);
    },
    async uploadArtifact(projectId, runId, request) {
      const response = await client.uploadArtifact(projectId, runId, request);
      return { artifactId: response.artifactId };
    },
  };
}
