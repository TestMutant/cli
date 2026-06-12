import type { HostedRunnerConfig, HostedRunnerTestDefinition } from "./hosted-runner-config";
import {
  HostedRunnerApiClient,
  type CliRunImplementation,
  type HostedRunnerArtifactUploadRequest,
  type HostedRunnerHeartbeatResponse,
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
  status: "Passed" | "Failed" | "Cancelled" | "TimedOut";
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
  heartbeat(
    projectId: string,
    runId: string,
  ): Promise<HostedRunnerHeartbeatResponse>;
  reportTestResult(
    projectId: string,
    runId: string,
    implementationId: string,
    request: HostedRunnerTestResultRequest,
  ): Promise<{ resultId: string | null; validationAttemptId: string | null }>;
  completeRunResults(
    projectId: string,
    runId: string,
    request: HostedRunnerCompleteRunResultRequest,
  ): Promise<void>;
  uploadArtifact(
    projectId: string,
    runId: string,
    request: HostedRunnerArtifactUploadRequest,
  ): Promise<{
    artifactId: string | null;
    fileName?: string | null;
    contentType?: string | null;
  }>;
};

export type HostedRunnerOptions = {
  testExecutor?: HostedRunnerTestExecutor;
  resultReporter?: HostedRunnerResultReporter;
  heartbeatIntervalMs?: number;
};

type HostedRunnerTerminalStatus = "Cancelled" | "TimedOut";

class HostedRunnerStoppedError extends Error {
  constructor(
    readonly status: HostedRunnerTerminalStatus,
    message: string,
    readonly errorMessage: string | null,
  ) {
    super(message);
    this.name = "HostedRunnerStoppedError";
  }
}

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
  const heartbeatMonitor = createHeartbeatMonitor(
    config,
    resultReporter,
    options.heartbeatIntervalMs ?? 30_000,
  );

  const startedAtUtc = new Date().toISOString();
  let testSummary: TestRunSummary;

  try {
    heartbeatMonitor.start();
    testSummary = await executeTests(testExecutor, implementations, {
      baseUrl,
      perTestTimeoutMs,
      traceMode: "retain-on-failure",
      videoMode: "retain-on-failure",
      captureRepairFeedback: true,
      signal: heartbeatMonitor.signal,
    });
    heartbeatMonitor.throwIfStopped();
  } catch (error) {
    if (error instanceof HostedRunnerStoppedError) {
      const completedAtUtc = new Date().toISOString();
      const durationMs =
        new Date(completedAtUtc).getTime() - new Date(startedAtUtc).getTime();
      await completeStoppedRun(
        resultReporter,
        config,
        error,
        implementations.length,
        baseUrl,
        startedAtUtc,
        completedAtUtc,
        durationMs,
      );

      return {
        runId: config.runId,
        projectId: config.projectId,
        status: error.status,
        totalTests: implementations.length,
        passedTests: 0,
        failedTests: 0,
        durationMs,
        artifactsUploaded: 0,
      };
    }

    throw error;
  } finally {
    await heartbeatMonitor.stop();
  }

  const completedAtUtc = new Date().toISOString();
  const durationMs = new Date(completedAtUtc).getTime() - new Date(startedAtUtc).getTime();

  // Report per-test results and upload artifacts (best-effort).
  let artifactsUploaded = 0;

  for (const test of testSummary.tests) {
    heartbeatMonitor.throwIfStopped();
    const resultStatus =
      test.status === "Passed" ? ResultStatus.Passed : ResultStatus.Failed;

    const initialOutputJson = buildRepairFeedbackOutput(test, null, null);
    const baseRequest = buildTestResultRequest(
      resultStatus,
      baseUrl,
      startedAtUtc,
      completedAtUtc,
      test,
      initialOutputJson,
    );
    const { resultId, validationAttemptId } = await resultReporter
      .reportTestResult(
        config.projectId,
        config.runId,
        test.implementationId,
        baseRequest,
      )
      .catch(() => ({ resultId: null, validationAttemptId: null }));

    // Upload artifacts for this test result (best-effort).
    const artifactUploads = await uploadTestArtifacts(
      resultReporter,
      config.projectId,
      config.runId,
      resultId,
      validationAttemptId,
      test,
      maxArtifactSizeBytes,
    );
    artifactsUploaded += artifactUploads.uploadedCount;
    heartbeatMonitor.throwIfStopped();

    const finalOutputJson = buildRepairFeedbackOutput(
      test,
      artifactUploads,
      validationAttemptId,
    );

    if (finalOutputJson && finalOutputJson !== initialOutputJson) {
      await resultReporter
        .reportTestResult(config.projectId, config.runId, test.implementationId, {
          ...baseRequest,
          outputJson: finalOutputJson,
        })
        .catch(() => ({ resultId: null, validationAttemptId: null }));
    }
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

function createHeartbeatMonitor(
  config: HostedRunnerConfig,
  reporter: HostedRunnerResultReporter,
  intervalMs: number,
): {
  signal: AbortSignal;
  start(): void;
  stop(): Promise<void>;
  throwIfStopped(): void;
} {
  const controller = new AbortController();
  let stopped = false;
  let loop: Promise<void> | null = null;
  let tokenExpiryTimeout: NodeJS.Timeout | null = null;
  let runTimeout: NodeJS.Timeout | null = null;
  let stopReason: HostedRunnerStoppedError | null = null;

  const stopWith = (reason: HostedRunnerStoppedError): void => {
    if (stopReason) {
      return;
    }

    stopReason = reason;
    controller.abort(reason);
  };

  const clearTokenExpiryTimeout = (): void => {
    if (tokenExpiryTimeout) {
      clearTimeout(tokenExpiryTimeout);
      tokenExpiryTimeout = null;
    }
  };

  const clearRunTimeout = (): void => {
    if (runTimeout) {
      clearTimeout(runTimeout);
      runTimeout = null;
    }
  };

  const scheduleTokenExpiry = (expiresAtUtc: string): void => {
    const expiresAtMs = new Date(expiresAtUtc).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }

    clearTokenExpiryTimeout();
    const delayMs = Math.max(0, expiresAtMs - Date.now() - 1_000);
    tokenExpiryTimeout = setTimeout(() => {
      stopWith(
        new HostedRunnerStoppedError(
          "TimedOut",
          "Hosted runner session token expired.",
          "Hosted runner session token expired before the run completed.",
        ),
      );
    }, delayMs);
    tokenExpiryTimeout.unref?.();
  };

  const scheduleRunTimeout = (): void => {
    const delayMs = Math.max(0.001, config.limits.runTimeoutSeconds) * 1000;
    runTimeout = setTimeout(() => {
      stopWith(
        new HostedRunnerStoppedError(
          "TimedOut",
          "Hosted runner job exceeded the run timeout.",
          `Hosted runner timed out after ${config.limits.runTimeoutSeconds} seconds.`,
        ),
      );
    }, delayMs);
    runTimeout.unref?.();
  };

  const sendHeartbeat = async (): Promise<void> => {
    const heartbeat = await reporter.heartbeat(config.projectId, config.runId);
    if (stopped || controller.signal.aborted) {
      return;
    }

    if (!heartbeat.ok) {
      stopWith(
        new HostedRunnerStoppedError(
          "Cancelled",
          "Hosted runner heartbeat was rejected.",
          "Hosted runner heartbeat was rejected by the API.",
        ),
      );
      return;
    }

    scheduleTokenExpiry(heartbeat.expiresAtUtc);
  };

  return {
    signal: controller.signal,
    start() {
      if (loop) {
        return;
      }

      scheduleRunTimeout();
      const normalizedIntervalMs = Math.max(250, intervalMs);
      loop = (async () => {
        while (!stopped && !controller.signal.aborted) {
          try {
            await sendHeartbeat();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            stopWith(
              new HostedRunnerStoppedError(
                "Cancelled",
                "Hosted runner heartbeat failed.",
                message,
              ),
            );
            break;
          }

          await wait(normalizedIntervalMs, controller.signal);
        }
      })().catch(() => {});
    },
    async stop() {
      stopped = true;
      clearTokenExpiryTimeout();
      clearRunTimeout();
      if (!controller.signal.aborted) {
        controller.abort();
      }

      await loop;
      clearTokenExpiryTimeout();
      clearRunTimeout();
    },
    throwIfStopped() {
      if (stopReason) {
        throw stopReason;
      }
    },
  };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

async function completeStoppedRun(
  reporter: HostedRunnerResultReporter,
  config: HostedRunnerConfig,
  error: HostedRunnerStoppedError,
  totalTests: number,
  environmentUrl: string | null,
  startedAtUtc: string,
  completedAtUtc: string,
  durationMs: number,
): Promise<void> {
  const runStatus = error.status === "Cancelled"
    ? RunStatus.Cancelled
    : RunStatus.TimedOut;

  await reporter
    .completeRunResults(config.projectId, config.runId, {
      status: runStatus,
      summary: error.message,
      errorMessage: error.errorMessage,
      totalTests,
      passedTests: 0,
      failedTests: 0,
      durationMs,
      environmentUrl,
      startedAtUtc,
      completedAtUtc,
    })
    .catch(() => {});
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
  captureRepairFeedback: boolean;
  signal?: AbortSignal;
};

type UploadedArtifactReference = {
  artifactId: string | null;
  fileName: string | null;
  contentType: string | null;
};

type TestArtifactUploads = {
  uploadedCount: number;
  screenshot: UploadedArtifactReference | null;
  trace: UploadedArtifactReference | null;
  video: UploadedArtifactReference | null;
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
    const summary = await testExecutor(implementations, {
      baseUrl: options.baseUrl,
      perTestTimeoutMs: options.perTestTimeoutMs,
      traceMode: options.traceMode,
      videoMode: options.videoMode,
      captureRepairFeedback: options.captureRepairFeedback,
      signal: options.signal,
    });
    const stopReason = getHostedRunnerStopReason(options.signal);
    if (stopReason) {
      throw stopReason;
    }

    return summary;
  } catch (error) {
    const stopReason = getHostedRunnerStopReason(options.signal);
    if (stopReason) {
      throw stopReason;
    }

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

function getHostedRunnerStopReason(
  signal: AbortSignal | undefined,
): HostedRunnerStoppedError | null {
  return signal?.aborted && signal.reason instanceof HostedRunnerStoppedError
    ? signal.reason
    : null;
}

/**
 * Uploads screenshot, trace, and video artifacts for a single test result.
 * Each upload is best-effort; failures are silently ignored.
 * Artifacts exceeding the max size limit are skipped.
 * Returns both the upload count and normalized artifact references.
 */
async function uploadTestArtifacts(
  reporter: HostedRunnerResultReporter,
  projectId: string,
  runId: string,
  resultId: string | null,
  validationAttemptId: string | null,
  test: TestRunResult,
  maxArtifactSizeBytes: number,
): Promise<TestArtifactUploads> {
  const artifacts: Array<{
    key: "screenshot" | "trace" | "video";
    kind: number;
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }> = [];

  if (test.screenshotBuffer) {
    artifacts.push({
      key: "screenshot",
      kind: ArtifactKind.Screenshot,
      fileName: `${safeFilePart(test.implementationId)}-screenshot.png`,
      contentType: "image/png",
      buffer: test.screenshotBuffer,
    });
  }

  if (test.traceBuffer) {
    artifacts.push({
      key: "trace",
      kind: ArtifactKind.Trace,
      fileName: `${safeFilePart(test.implementationId)}-trace.zip`,
      contentType: "application/zip",
      buffer: test.traceBuffer,
    });
  }

  if (test.videoBuffer) {
    artifacts.push({
      key: "video",
      kind: ArtifactKind.Video,
      fileName: `${safeFilePart(test.implementationId)}-video.webm`,
      contentType: "video/webm",
      buffer: test.videoBuffer,
    });
  }

  let uploaded = 0;
  const references: TestArtifactUploads = {
    uploadedCount: 0,
    screenshot: null,
    trace: null,
    video: null,
  };

  for (const artifact of artifacts) {
    if (artifact.buffer.byteLength > maxArtifactSizeBytes) {
      references[artifact.key] = {
        artifactId: null,
        fileName: artifact.fileName,
        contentType: artifact.contentType,
      };
      continue;
    }

    const response = await reporter
      .uploadArtifact(projectId, runId, {
        kind: artifact.kind,
        fileName: artifact.fileName,
        contentType: artifact.contentType,
        contentBase64: artifact.buffer.toString("base64"),
        runImplementationResultId: resultId,
        validationAttemptId,
      })
      .catch(() => ({
        artifactId: null,
        fileName: artifact.fileName,
        contentType: artifact.contentType,
      }));

    references[artifact.key] = {
      artifactId: response.artifactId,
      fileName: response.fileName ?? artifact.fileName,
      contentType: response.contentType ?? artifact.contentType,
    };

    if (response.artifactId) {
      uploaded += 1;
    }
  }

  return {
    ...references,
    uploadedCount: uploaded,
  };
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "test";
}

function buildTestResultRequest(
  resultStatus: number,
  baseUrl: string | null,
  startedAtUtc: string,
  completedAtUtc: string,
  test: TestRunResult,
  outputJson: string | null,
): HostedRunnerTestResultRequest {
  return {
    status: resultStatus,
    durationMs: test.durationMs,
    errorMessage: test.errorMessage,
    environmentUrl: baseUrl,
    startedAtUtc,
    completedAtUtc,
    outputJson,
  };
}

function buildRepairFeedbackOutput(
  test: TestRunResult,
  uploads: TestArtifactUploads | null,
  validationAttemptId: string | null,
): string | null {
  if (test.status !== "Failed") {
    return null;
  }

  const consoleLogs = normalizeFeedbackEntries(test.repairFeedback?.consoleLogs);
  const browserObservations = normalizeFeedbackEntries(
    test.repairFeedback?.browserObservations,
  );
  const screenshotReference = buildArtifactReference(
    uploads?.screenshot ?? (test.screenshotBuffer ? defaultArtifactReference(test, "screenshot") : null),
    validationAttemptId,
  );
  const traceSummary = buildTraceSummary(
    uploads?.trace ?? (test.traceBuffer ? defaultArtifactReference(test, "trace") : null),
    validationAttemptId,
  );

  if (
    !test.errorMessage
    && !screenshotReference
    && !traceSummary
    && consoleLogs.length === 0
    && browserObservations.length === 0
  ) {
    return null;
  }

  return JSON.stringify({
    errorMessage: test.errorMessage,
    screenshotReference,
    traceSummary,
    consoleLogs,
    browserObservations,
  });
}

function buildArtifactReference(
  reference: UploadedArtifactReference | null,
  validationAttemptId: string | null,
): Record<string, string | boolean | null> | null {
  if (!reference) {
    return null;
  }

  return {
    artifactId: reference.artifactId,
    validationAttemptId,
    fileName: reference.fileName,
    contentType: reference.contentType,
    uploaded: Boolean(reference.artifactId),
  };
}

function buildTraceSummary(
  reference: UploadedArtifactReference | null,
  validationAttemptId: string | null,
): Record<string, string | boolean | null> | null {
  if (!reference) {
    return null;
  }

  return {
    artifactId: reference.artifactId,
    validationAttemptId,
    fileName: reference.fileName,
    contentType: reference.contentType,
    uploaded: Boolean(reference.artifactId),
    summary: reference.artifactId
      ? `Playwright trace uploaded as ${reference.fileName ?? "trace.zip"}.`
      : `Playwright trace was captured locally as ${reference.fileName ?? "trace.zip"} but was not uploaded.`,
  };
}

function defaultArtifactReference(
  test: TestRunResult,
  kind: "screenshot" | "trace",
): UploadedArtifactReference {
  return kind === "screenshot"
    ? {
        artifactId: null,
        fileName: `${safeFilePart(test.implementationId)}-screenshot.png`,
        contentType: "image/png",
      }
    : {
        artifactId: null,
        fileName: `${safeFilePart(test.implementationId)}-trace.zip`,
        contentType: "application/zip",
      };
}

function normalizeFeedbackEntries(entries: string[] | undefined): string[] {
  if (!entries) {
    return [];
  }

  return entries
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 20);
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
    async heartbeat(projectId, runId) {
      return client.heartbeat(projectId, runId);
    },
    async reportTestResult(projectId, runId, implementationId, request) {
      const response = await client.reportTestResult(projectId, runId, implementationId, request);
      return {
        resultId: response.resultId,
        validationAttemptId: response.validationAttemptId ?? null,
      };
    },
    async completeRunResults(projectId, runId, request) {
      await client.completeRunResults(projectId, runId, request);
    },
    async uploadArtifact(projectId, runId, request) {
      const response = await client.uploadArtifact(projectId, runId, request);
      return {
        artifactId: response.artifactId,
        fileName: response.fileName,
        contentType: response.contentType,
      };
    },
  };
}
