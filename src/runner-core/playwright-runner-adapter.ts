import { join } from "node:path";
import {
  artifactKindFromAttachment,
  writeArtifact,
} from "./artifacts";
import {
  runPlaywrightTests,
  type TestRunResult,
  type TestRunSummary,
} from "./playwright-execution";
import { validateGeneratedPlaywrightSource } from "./generated-source-policy";
import type {
  ExecutePlaywrightTestsRequest,
  RunnerArtifactReference,
  RunnerExecutionSummary,
  RunnerTestDefinition,
  RunnerTestResult,
  ValidateDraftPlaywrightTestRequest,
  ValidateDraftPlaywrightTestResponse,
} from "./runner-contracts";

export type InternalPlaywrightExecutionOptions = {
  artifactDirectory: string;
  storageStatePath?: string | null;
  explicitSecrets?: string[];
  signal?: AbortSignal;
};

export async function executeRunnerTests(
  request: ExecutePlaywrightTestsRequest,
  options: InternalPlaywrightExecutionOptions,
): Promise<RunnerExecutionSummary> {
  const summary = await runPlaywrightTests(
    request.tests.map(toCoreTestDefinition),
    {
      baseUrl: request.baseUrl,
      storageStatePath: options.storageStatePath,
      perTestTimeoutMs: toNumber(request.perTestTimeoutMs) ?? undefined,
      traceMode: "retain-on-failure",
      videoMode: "retain-on-failure",
      captureRepairFeedback: true,
      captureStepEvidence: true,
      signal: options.signal,
    },
  );

  return toRunnerSummary(summary, request.tests, options.artifactDirectory);
}

export async function validateDraftPlaywrightTest(
  request: ValidateDraftPlaywrightTestRequest,
  options: InternalPlaywrightExecutionOptions,
): Promise<ValidateDraftPlaywrightTestResponse> {
  const policy = validateGeneratedPlaywrightSource(request.source, options.explicitSecrets);
  if (!policy.valid) {
    return {
      passed: false,
      summary: {
        kind: "playwright",
        baseUrl: request.baseUrl,
        total: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
        errored: 0,
        tests: [],
      },
      failureExcerpt: policy.error,
      artifacts: [],
      failureClassification: "test_code",
    };
  }

  const test: RunnerTestDefinition = {
    testId: "generated-draft",
    testSpecId: null,
    name: request.name,
    runnerKind: "playwright",
    source: request.source,
    metadata: null,
  };
  const summary = await executeRunnerTests(
    {
      baseUrl: request.baseUrl,
      environment: null,
      tests: [test],
      perTestTimeoutMs: request.timeoutMs,
      runTimeoutMs: null,
      artifactDirectory: null,
    },
    options,
  );
  const failure = summary.tests.find(
    (candidate) => candidate.status !== "Passed",
  );

  return {
    passed: toNumber(summary.failed) === 0 &&
      toNumber(summary.errored) === 0 &&
      (toNumber(summary.total) ?? 0) > 0,
    summary,
    failureExcerpt: failure?.errorMessage ?? null,
    artifacts: summary.tests.flatMap((candidate) => candidate.artifacts),
    failureClassification: failure ? classifyFailure(failure.errorMessage) : null,
  };
}

function classifyFailure(message: string | null): string {
  const normalized = (message ?? "").toLowerCase();
  if (/syntax|cannot find module|strict mode|locator|timeout|playwright/.test(normalized)) {
    return "test_code";
  }
  if (/expect|assert/.test(normalized)) {
    return "assertion";
  }
  if (/browser|process|spawn|install|enoent|eacces|connection refused/.test(normalized)) {
    return "runner";
  }
  return "unknown";
}

async function toRunnerSummary(
  summary: TestRunSummary,
  definitions: RunnerTestDefinition[],
  artifactDirectory: string,
): Promise<RunnerExecutionSummary> {
  const definitionById = new Map(definitions.map((test) => [test.testId, test]));
  const tests = await Promise.all(
    summary.tests.map((test) =>
      toRunnerTestResult(test, definitionById.get(test.implementationId), artifactDirectory),
    ),
  );

  return {
    kind: "playwright",
    baseUrl: summary.baseUrl,
    total: summary.total,
    passed: summary.passed,
    failed: tests.filter((test) => test.status === "Failed").length,
    skipped: tests.filter((test) => test.status === "Skipped").length,
    errored: tests.filter((test) => test.status === "Errored").length,
    tests,
  };
}

async function toRunnerTestResult(
  test: TestRunResult,
  definition: RunnerTestDefinition | undefined,
  artifactDirectory: string,
): Promise<RunnerTestResult> {
  return {
    testId: test.implementationId,
    testSpecId: definition?.testSpecId ?? null,
    name: test.name,
    runnerKind: test.runnerKind,
    status: test.status,
    durationMs: test.durationMs,
    errorMessage: test.errorMessage,
    repairFeedback: test.repairFeedback ?? null,
    artifacts: await writeTestArtifacts(test, artifactDirectory),
  };
}

async function writeTestArtifacts(
  test: TestRunResult,
  artifactDirectory: string,
): Promise<RunnerArtifactReference[]> {
  const artifacts: RunnerArtifactReference[] = [];
  const prefix = test.implementationId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "test";

  for (const [name, buffer] of [
    ["screenshot", test.screenshotBuffer],
    ["trace", test.traceBuffer],
    ["video", test.videoBuffer],
  ] as const) {
    if (!buffer) {
      continue;
    }

    const descriptor = artifactKindFromAttachment(name);
    artifacts.push(
      await writeArtifact(
        join(artifactDirectory, prefix),
        descriptor.kind,
        `${prefix}-${descriptor.kind}${descriptor.extension}`,
        descriptor.contentType,
        buffer,
      ),
    );
  }

  return artifacts;
}

function toCoreTestDefinition(test: RunnerTestDefinition) {
  return {
    implementationId: test.testId,
    testSpecId: test.testSpecId,
    runnerKind: test.runnerKind,
    name: test.name,
    source: test.source,
  };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
