import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { ensurePlaywrightBrowserInstalled } from "../playwright-install";
import { createRequire } from "node:module";

export type RunnerCoreTestDefinition = {
  implementationId: string;
  testSpecId?: string | null;
  testLayer?: string | null;
  runnerKind: string;
  name: string;
  source: string;
};

export type TestRunStatus = "Passed" | "Failed";

export type TestRepairFeedback = {
  consoleLogs: string[];
  browserObservations: string[];
};

export type TestRunEvidenceStatus = "Passed" | "Failed";

export type TestRunEvidenceStep = {
  index: number;
  title: string;
  status: TestRunEvidenceStatus;
  durationMs: number | null;
  errorMessage: string | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  screenshotBuffer: Buffer | null;
  screenshotFileName: string | null;
  consoleStartIndex: number;
  consoleEndIndex: number;
  networkStartIndex: number;
  networkEndIndex: number;
};

export type TestRunConsoleEntry = {
  timestampMs: number | null;
  type: string;
  text: string;
};

export type TestRunNetworkEntry = {
  timestampMs: number | null;
  event: "request" | "response" | "requestfailed";
  method: string | null;
  url: string;
  resourceType: string | null;
  status: number | null;
  failureText: string | null;
};

export type TestRunSourceContext = {
  language: "typescript";
  excerpt: string;
  failureLine: number | null;
};

export type TestRunEvidence = {
  schemaVersion: 1;
  source: "testmutant-playwright-step-snapshot";
  steps: TestRunEvidenceStep[];
  console: {
    entries: TestRunConsoleEntry[];
    capped: boolean;
  };
  network: {
    entries: TestRunNetworkEntry[];
    capped: boolean;
  };
  sourceContext: TestRunSourceContext;
  caps: {
    maxSteps: number;
    maxConsoleEntries: number;
    maxNetworkEntries: number;
  };
  redaction: {
    headers: string[];
    queryParameters: string[];
    logs: boolean;
    screenshots: string;
  };
  reporterFallback: boolean;
};

export type TestRunResult = {
  implementationId: string;
  runnerKind: string;
  name: string;
  status: TestRunStatus;
  errorMessage: string | null;
  durationMs: number | null;
  screenshotBuffer: Buffer | null;
  traceBuffer: Buffer | null;
  videoBuffer: Buffer | null;
  repairFeedback?: TestRepairFeedback;
  evidence?: TestRunEvidence;
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
  perTestTimeoutMs?: number;
  traceMode?: "off" | "retain-on-failure" | "on";
  videoMode?: "off" | "retain-on-failure";
  captureRepairFeedback?: boolean;
  captureStepEvidence?: boolean;
  signal?: AbortSignal;
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
  signal?: AbortSignal;
};

export type PlaywrightCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type WrittenTest = {
  test: RunnerCoreTestDefinition;
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

type PlaywrightAttachment = {
  name?: string;
  contentType?: string;
  path?: string;
};

type PlaywrightIoEntry =
  | string
  | {
      text?: string;
      buffer?: string;
      message?: string;
    };

type PlaywrightStep = {
  title?: string;
  category?: string;
  duration?: number;
  startTime?: string;
  error?: PlaywrightError;
  steps?: PlaywrightStep[];
};

type PlaywrightCaseResult = {
  status?: string;
  duration?: number;
  error?: PlaywrightError;
  errors?: PlaywrightError[];
  attachments?: PlaywrightAttachment[];
  stdout?: PlaywrightIoEntry[];
  stderr?: PlaywrightIoEntry[];
  steps?: PlaywrightStep[];
};

type PlaywrightError = {
  message?: string;
  stack?: string;
};

type RecorderEvidence = {
  schemaVersion?: number;
  source?: string;
  steps?: RecorderEvidenceStep[];
  console?: {
    entries?: TestRunConsoleEntry[];
    capped?: boolean;
  };
  network?: {
    entries?: TestRunNetworkEntry[];
    capped?: boolean;
  };
  caps?: {
    maxSteps?: number;
    maxConsoleEntries?: number;
    maxNetworkEntries?: number;
  };
  redaction?: {
    headers?: string[];
    queryParameters?: string[];
    logs?: boolean;
    screenshots?: string;
  };
};

type RecorderEvidenceStep = {
  index?: number;
  title?: string;
  status?: TestRunEvidenceStatus;
  durationMs?: number | null;
  errorMessage?: string | null;
  startedAtMs?: number | null;
  completedAtMs?: number | null;
  screenshotAttachmentName?: string | null;
  screenshotFileName?: string | null;
  consoleStartIndex?: number;
  consoleEndIndex?: number;
  networkStartIndex?: number;
  networkEndIndex?: number;
};

const PLAYWRIGHT_TYPE = "playwright";
const EVIDENCE_ATTACHMENT_NAME = "testmutant-evidence";
const STEP_SCREENSHOT_ATTACHMENT_PREFIX = "testmutant-step-screenshot-";
const MAX_EVIDENCE_STEPS = 60;
const MAX_CONSOLE_ENTRIES = 100;
const MAX_NETWORK_ENTRIES = 120;
const STEP_RECORDER_FILE_NAME = "testmutant-step-recorder.ts";
const TESTMUTANT_STEP_RECORDER_SOURCE = String.raw`
import { AsyncLocalStorage } from "node:async_hooks";
import { writeFile } from "node:fs/promises";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
export * from "@playwright/test";

type EvidenceStatus = "Passed" | "Failed";
type ConsoleEntry = { timestampMs: number; type: string; text: string };
type NetworkEntry = {
  timestampMs: number;
  event: "request" | "response" | "requestfailed";
  method: string | null;
  url: string;
  resourceType: string | null;
  status: number | null;
  failureText: string | null;
};
type StepEntry = {
  index: number;
  title: string;
  status: EvidenceStatus;
  durationMs: number;
  errorMessage: string | null;
  startedAtMs: number;
  completedAtMs: number;
  screenshotAttachmentName: string | null;
  screenshotFileName: string | null;
  consoleStartIndex: number;
  consoleEndIndex: number;
  networkStartIndex: number;
  networkEndIndex: number;
};
type EvidenceContext = {
  page: Page;
  testInfo: TestInfo;
  startedAtMs: number;
  nextStepIndex: number;
  steps: StepEntry[];
  stepsCapped: boolean;
  console: ConsoleEntry[];
  consoleCapped: boolean;
  network: NetworkEntry[];
  networkCapped: boolean;
};

const EVIDENCE_ATTACHMENT_NAME = "testmutant-evidence";
const STEP_SCREENSHOT_ATTACHMENT_PREFIX = "testmutant-step-screenshot-";
const MAX_STEPS = 60;
const MAX_CONSOLE = 100;
const MAX_NETWORK = 120;
const REDACTED = "[REDACTED]";
const SENSITIVE_QUERY_NAMES = /token|secret|password|pass|key|code|state|session|cookie|auth/i;
const SENSITIVE_SCREENSHOT_SELECTOR = [
  "input[type='password']",
  "input[name*='password' i]",
  "input[name*='token' i]",
  "input[name*='secret' i]",
  "input[name*='key' i]",
  "input[name*='code' i]",
  "input[name*='card' i]",
  "input[id*='password' i]",
  "input[id*='token' i]",
  "input[id*='secret' i]",
  "input[id*='key' i]",
  "input[id*='card' i]",
  "textarea[name*='secret' i]",
  "textarea[name*='token' i]"
].join(", ");

const storage = new AsyncLocalStorage<EvidenceContext>();

const test = base.extend<{ _testmutantEvidence: void }>({
  _testmutantEvidence: [async ({ page }, use, testInfo) => {
    const context: EvidenceContext = {
      page,
      testInfo,
      startedAtMs: Date.now(),
      nextStepIndex: 1,
      steps: [],
      stepsCapped: false,
      console: [],
      consoleCapped: false,
      network: [],
      networkCapped: false
    };

    attachPageEvents(page, context);
    await storage.run(context, async () => {
      try {
        await use();
      } finally {
        await attachEvidence(context);
      }
    });
  }, { auto: true }]
});

const originalStep = base.step.bind(base);
const recordedStep = (async (title: string, body: (...args: unknown[]) => unknown, options?: unknown) => {
  const context = storage.getStore();
  if (!context) {
    return originalStep(title, body as never, options as never);
  }

  const index = context.nextStepIndex++;
  const started = Date.now();
  const consoleStartIndex = context.console.length;
  const networkStartIndex = context.network.length;
  let errorMessage: string | null = null;

  return originalStep(title, async (...args: unknown[]) => {
    try {
      return await body(...args);
    } catch (error) {
      errorMessage = redact(formatError(error));
      throw error;
    } finally {
      if (context.steps.length >= MAX_STEPS) {
        context.stepsCapped = true;
        return;
      }

      const completed = Date.now();
      const screenshot = await captureStepScreenshot(context, index);
      context.steps.push({
        index,
        title: redact(String(title)),
        status: errorMessage ? "Failed" : "Passed",
        durationMs: completed - started,
        errorMessage,
        startedAtMs: started - context.startedAtMs,
        completedAtMs: completed - context.startedAtMs,
        screenshotAttachmentName: screenshot.attachmentName,
        screenshotFileName: screenshot.fileName,
        consoleStartIndex,
        consoleEndIndex: context.console.length,
        networkStartIndex,
        networkEndIndex: context.network.length
      });
    }
  }, options as never);
}) as typeof base.step;
Object.assign(recordedStep, originalStep);
(test as typeof base).step = recordedStep;

export { expect, test };

function attachPageEvents(page: Page, context: EvidenceContext): void {
  page.on("console", (message) => {
    pushConsole(context, {
      timestampMs: elapsed(context),
      type: message.type(),
      text: redact(message.text())
    });
  });

  page.on("pageerror", (error) => {
    pushConsole(context, {
      timestampMs: elapsed(context),
      type: "pageerror",
      text: redact(formatError(error))
    });
  });

  page.on("request", (request) => {
    pushNetwork(context, {
      timestampMs: elapsed(context),
      event: "request",
      method: request.method(),
      url: redactUrl(request.url()),
      resourceType: request.resourceType(),
      status: null,
      failureText: null
    });
  });

  page.on("response", (response) => {
    const request = response.request();
    pushNetwork(context, {
      timestampMs: elapsed(context),
      event: "response",
      method: request.method(),
      url: redactUrl(response.url()),
      resourceType: request.resourceType(),
      status: response.status(),
      failureText: null
    });
  });

  page.on("requestfailed", (request) => {
    pushNetwork(context, {
      timestampMs: elapsed(context),
      event: "requestfailed",
      method: request.method(),
      url: redactUrl(request.url()),
      resourceType: request.resourceType(),
      status: null,
      failureText: redact(request.failure()?.errorText ?? "request failed")
    });
  });
}

async function captureStepScreenshot(
  context: EvidenceContext,
  index: number,
): Promise<{ attachmentName: string | null; fileName: string | null }> {
  const attachmentName = STEP_SCREENSHOT_ATTACHMENT_PREFIX + String(index);
  const fileName = attachmentName + ".png";
  const path = context.testInfo.outputPath(fileName);

  try {
    await context.page.screenshot({
      path,
      fullPage: false,
      animations: "disabled",
      mask: [context.page.locator(SENSITIVE_SCREENSHOT_SELECTOR)]
    });
    await context.testInfo.attach(attachmentName, {
      path,
      contentType: "image/png"
    });
    return { attachmentName, fileName };
  } catch {
    return { attachmentName: null, fileName: null };
  }
}

async function attachEvidence(context: EvidenceContext): Promise<void> {
  const path = context.testInfo.outputPath("testmutant-evidence.json");
  const payload = {
    schemaVersion: 1,
    source: "testmutant-playwright-step-snapshot",
    steps: context.steps,
    stepsCapped: context.stepsCapped,
    console: {
      entries: context.console,
      capped: context.consoleCapped
    },
    network: {
      entries: context.network,
      capped: context.networkCapped
    },
    caps: {
      maxSteps: MAX_STEPS,
      maxConsoleEntries: MAX_CONSOLE,
      maxNetworkEntries: MAX_NETWORK
    },
    redaction: {
      headers: ["authorization", "cookie", "set-cookie", "x-api-key"],
      queryParameters: ["token", "secret", "password", "key", "code", "state", "session"],
      logs: true,
      screenshots: "Sensitive input fields are masked before screenshot capture where selectors can be detected."
    }
  };

  try {
    await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
    await context.testInfo.attach(EVIDENCE_ATTACHMENT_NAME, {
      path,
      contentType: "application/json"
    });
  } catch {
  }
}

function pushConsole(context: EvidenceContext, entry: ConsoleEntry): void {
  if (context.console.length >= MAX_CONSOLE) {
    context.consoleCapped = true;
    return;
  }

  context.console.push(entry);
}

function pushNetwork(context: EvidenceContext, entry: NetworkEntry): void {
  if (context.network.length >= MAX_NETWORK) {
    context.networkCapped = true;
    return;
  }

  context.network.push(entry);
}

function elapsed(context: EvidenceContext): number {
  return Date.now() - context.startedAtMs;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const [key] of url.searchParams) {
      if (SENSITIVE_QUERY_NAMES.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return redact(value);
  }
}

function redact(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer " + REDACTED)
    .replace(/\b(token|secret|password|api[_-]?key|session|cookie|authorization)\b\s*[:=]\s*["']?[^"',;\s]+/gi, "$1=" + REDACTED)
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .slice(0, 1000);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}
`;

export async function runPlaywrightTests(
  tests: RunnerCoreTestDefinition[],
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
    screenshotBuffer: null,
    traceBuffer: null,
    videoBuffer: null,
  }));

  if (supported.length === 0) {
    return summarize(options.baseUrl ?? null, unsupportedResults);
  }

  const workDir = await mkdtemp(join(tmpdir(), "testmutant-playwright-"));

  try {
    const writtenTests = await writePlaywrightWorkspace(
      workDir,
      supported,
      options,
    );

    const commandRunner = options.commandRunner ?? defaultCommandRunner;

    const runtimeEnv = {
      ...process.env,
      NODE_PATH: buildNodePath(process.env.NODE_PATH),
    };

    await ensureBrowserInstalledForRun(commandRunner, workDir, runtimeEnv, options.signal);

    const result = await commandRunner(
      process.execPath,
      getPlaywrightTestArgs(workDir, writtenTests),
      {
        cwd: workDir,
        env: runtimeEnv,
        signal: options.signal,
      },
    );

    const mappedResults = await mapPlaywrightResults(
      writtenTests,
      result,
      workDir,
      options.captureRepairFeedback === true,
      options.captureStepEvidence === true,
    );
    return summarize(options.baseUrl ?? null, [
      ...mappedResults,
      ...unsupportedResults,
    ]);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function isPlaywrightTest(test: RunnerCoreTestDefinition): boolean {
  return test.runnerKind.trim().toLowerCase() === PLAYWRIGHT_TYPE;
}

async function writePlaywrightWorkspace(
  workDir: string,
  tests: RunnerCoreTestDefinition[],
  options: PlaywrightExecutionOptions,
): Promise<WrittenTest[]> {
  const baseUrl = options.baseUrl ?? null;
  const perTestTimeoutMs = options.perTestTimeoutMs ?? 30_000;
  const traceMode = options.traceMode ?? "off";
  const videoMode = options.videoMode ?? "off";
  const captureStepEvidence = options.captureStepEvidence === true;

  await writeFile(
    join(workDir, "playwright.config.cjs"),
    [
      "module.exports = {",
      `  timeout: ${perTestTimeoutMs},`,
      "  workers: 1,",
      "  use: {",
      `    baseURL: ${JSON.stringify(baseUrl)},`,
      "    screenshot: 'only-on-failure',",
      `    trace: '${traceMode}',`,
      `    video: '${videoMode}',`,
      "  },",
      `  outputDir: './test-results',`,
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  if (captureStepEvidence) {
    await writeFile(
      join(workDir, STEP_RECORDER_FILE_NAME),
      TESTMUTANT_STEP_RECORDER_SOURCE,
      "utf8",
    );
  }

  const writtenTests: WrittenTest[] = [];
  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index]!;
    const fileName = `${String(index + 1).padStart(3, "0")}-${safeFilePart(
      test.implementationId,
    )}.spec.ts`;
    const filePath = join(workDir, fileName);
    const source = captureStepEvidence
      ? instrumentPlaywrightTestSource(test.source)
      : test.source;
    await writeFile(filePath, source, "utf8");
    writtenTests.push({ test, filePath, fileName });
  }

  return writtenTests;
}

async function mapPlaywrightResults(
  writtenTests: WrittenTest[],
  commandResult: PlaywrightCommandResult,
  workDir: string,
  captureRepairFeedback: boolean,
  captureStepEvidence: boolean,
): Promise<TestRunResult[]> {
  const report = parsePlaywrightReport(commandResult.stdout);
  const fileResults = new Map<string, TestRunResult>();

  const fallbackError =
    firstReportError(report) ??
    meaningfulStderr(commandResult.stderr) ??
    extractUsefulPlaywrightFailure(commandResult.stdout);

  if (report) {
    for (const suite of report.suites ?? []) {
      await collectSuiteResults(
        suite,
        writtenTests,
        fileResults,
        fallbackError,
        captureRepairFeedback,
        captureStepEvidence,
        workDir,
      );
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
      screenshotBuffer: null,
      traceBuffer: null,
      videoBuffer: null,
    };
  });
}

async function collectSuiteResults(
  suite: PlaywrightSuite,
  writtenTests: WrittenTest[],
  fileResults: Map<string, TestRunResult>,
  fallbackError: string | null,
  captureRepairFeedback: boolean,
  captureStepEvidence: boolean,
  workDir: string,
): Promise<void> {
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
    const primaryResult =
      result ??
      specs
        .flatMap((spec) => spec.tests ?? [])
        .flatMap((testCase) => testCase.results ?? [])
        .find(Boolean);

    const isFailed = Boolean(failedSpec || failedCase);
    let screenshotBuffer: Buffer | null = null;
    let traceBuffer: Buffer | null = null;
    let videoBuffer: Buffer | null = null;

    if (primaryResult) {
      traceBuffer = await readAttachmentByName(primaryResult, "trace", workDir);
      videoBuffer = await readAttachmentByName(primaryResult, "video", workDir);
    }

    if (isFailed && result) {
      screenshotBuffer = await readScreenshotAttachment(result, workDir);
    }

    const repairFeedback =
      captureRepairFeedback && isFailed
        ? extractRepairFeedback(failedSpec, result)
        : undefined;
    const evidence = captureStepEvidence && primaryResult
      ? await readStepEvidence(
          primaryResult,
          workDir,
          writtenTest.test.source,
          formatResultError(result) ?? fallbackError,
        )
      : undefined;

    fileResults.set(fileName, {
      implementationId: writtenTest.test.implementationId,
      runnerKind: writtenTest.test.runnerKind,
      name: writtenTest.test.name,
      status: isFailed ? "Failed" : "Passed",
      errorMessage: isFailed
        ? formatResultError(result) ?? fallbackError ?? "Playwright test failed."
        : null,
      durationMs: sumDurations(specs),
      screenshotBuffer,
      traceBuffer,
      videoBuffer,
      ...(repairFeedback ? { repairFeedback } : {}),
      ...(evidence ? { evidence } : {}),
    });
  }

  for (const child of suite.suites ?? []) {
    await collectSuiteResults(
      child,
      writtenTests,
      fileResults,
      fallbackError,
      captureRepairFeedback,
      captureStepEvidence,
      workDir,
    );
  }
}

async function readScreenshotAttachment(
  result: PlaywrightCaseResult,
  workDir: string,
): Promise<Buffer | null> {
  return readAttachmentByName(result, "screenshot", workDir);
}

async function readAttachmentByName(
  result: PlaywrightCaseResult,
  name: string,
  workDir: string,
): Promise<Buffer | null> {
  const attachment = result.attachments?.find(
    (a) => a.name === name && a.path,
  );

  if (!attachment?.path) {
    return null;
  }

  try {
    return await readFile(resolveAttachmentPath(attachment.path, workDir));
  } catch {
    return null;
  }
}

async function readStepEvidence(
  result: PlaywrightCaseResult,
  workDir: string,
  source: string,
  errorMessage: string | null,
): Promise<TestRunEvidence> {
  const recorderEvidence = await readRecorderEvidence(result, workDir);
  const sourceContext = buildSourceContext(source, errorMessage);

  if (recorderEvidence) {
    return {
      schemaVersion: 1,
      source: "testmutant-playwright-step-snapshot",
      steps: await buildRecordedEvidenceSteps(result, recorderEvidence, workDir),
      console: {
        entries: normalizeConsoleEntries(recorderEvidence.console?.entries),
        capped: recorderEvidence.console?.capped === true,
      },
      network: {
        entries: normalizeNetworkEntries(recorderEvidence.network?.entries),
        capped: recorderEvidence.network?.capped === true,
      },
      sourceContext,
      caps: {
        maxSteps: recorderEvidence.caps?.maxSteps ?? MAX_EVIDENCE_STEPS,
        maxConsoleEntries:
          recorderEvidence.caps?.maxConsoleEntries ?? MAX_CONSOLE_ENTRIES,
        maxNetworkEntries:
          recorderEvidence.caps?.maxNetworkEntries ?? MAX_NETWORK_ENTRIES,
      },
      redaction: {
        headers: recorderEvidence.redaction?.headers ?? [
          "authorization",
          "cookie",
          "set-cookie",
          "x-api-key",
        ],
        queryParameters: recorderEvidence.redaction?.queryParameters ?? [
          "token",
          "secret",
          "password",
          "key",
          "code",
          "state",
          "session",
        ],
        logs: recorderEvidence.redaction?.logs ?? true,
        screenshots:
          recorderEvidence.redaction?.screenshots ??
          "Sensitive input fields are masked before screenshot capture where selectors can be detected.",
      },
      reporterFallback: false,
    };
  }

  return {
    schemaVersion: 1,
    source: "testmutant-playwright-step-snapshot",
    steps: buildReporterEvidenceSteps(result.steps),
    console: { entries: [], capped: false },
    network: { entries: [], capped: false },
    sourceContext,
    caps: {
      maxSteps: MAX_EVIDENCE_STEPS,
      maxConsoleEntries: MAX_CONSOLE_ENTRIES,
      maxNetworkEntries: MAX_NETWORK_ENTRIES,
    },
    redaction: {
      headers: ["authorization", "cookie", "set-cookie", "x-api-key"],
      queryParameters: [
        "token",
        "secret",
        "password",
        "key",
        "code",
        "state",
        "session",
      ],
      logs: true,
      screenshots:
        "No step screenshots were captured from reporter step data.",
    },
    reporterFallback: true,
  };
}

async function readRecorderEvidence(
  result: PlaywrightCaseResult,
  workDir: string,
): Promise<RecorderEvidence | null> {
  const attachment = result.attachments?.find(
    (a) => a.name === EVIDENCE_ATTACHMENT_NAME && a.path,
  );

  if (!attachment?.path) {
    return null;
  }

  try {
    return JSON.parse(
      await readFile(resolveAttachmentPath(attachment.path, workDir), "utf8"),
    ) as RecorderEvidence;
  } catch {
    return null;
  }
}

async function buildRecordedEvidenceSteps(
  result: PlaywrightCaseResult,
  evidence: RecorderEvidence,
  workDir: string,
): Promise<TestRunEvidenceStep[]> {
  const steps: TestRunEvidenceStep[] = [];

  for (const [position, step] of (evidence.steps ?? []).entries()) {
    if (steps.length >= MAX_EVIDENCE_STEPS) {
      break;
    }

    const screenshotBuffer = step.screenshotAttachmentName
      ? await readAttachmentByName(result, step.screenshotAttachmentName, workDir)
      : null;

    steps.push({
      index: coercePositiveInt(step.index, position + 1),
      title: truncate(firstNonEmpty(step.title) ?? `Step ${position + 1}`, 200),
      status: step.status === "Failed" ? "Failed" : "Passed",
      durationMs: coerceNullableNumber(step.durationMs),
      errorMessage: firstNonEmpty(step.errorMessage),
      startedAtMs: coerceNullableNumber(step.startedAtMs),
      completedAtMs: coerceNullableNumber(step.completedAtMs),
      screenshotBuffer,
      screenshotFileName: firstNonEmpty(step.screenshotFileName),
      consoleStartIndex: coerceNonNegativeInt(step.consoleStartIndex, 0),
      consoleEndIndex: coerceNonNegativeInt(step.consoleEndIndex, 0),
      networkStartIndex: coerceNonNegativeInt(step.networkStartIndex, 0),
      networkEndIndex: coerceNonNegativeInt(step.networkEndIndex, 0),
    });
  }

  return steps;
}

function buildReporterEvidenceSteps(
  steps: PlaywrightStep[] | undefined,
): TestRunEvidenceStep[] {
  const flattened = flattenPlaywrightSteps(steps).slice(0, MAX_EVIDENCE_STEPS);

  return flattened.map((step, index) => ({
    index: index + 1,
    title: truncate(firstNonEmpty(step.title) ?? `Step ${index + 1}`, 200),
    status: step.error ? "Failed" : "Passed",
    durationMs: coerceNullableNumber(step.duration),
    errorMessage: step.error ? formatError(step.error) : null,
    startedAtMs: null,
    completedAtMs: null,
    screenshotBuffer: null,
    screenshotFileName: null,
    consoleStartIndex: 0,
    consoleEndIndex: 0,
    networkStartIndex: 0,
    networkEndIndex: 0,
  }));
}

function flattenPlaywrightSteps(steps: PlaywrightStep[] | undefined): PlaywrightStep[] {
  const flattened: PlaywrightStep[] = [];

  for (const step of steps ?? []) {
    if (step.category === "test.step") {
      flattened.push(step);
    }

    flattened.push(...flattenPlaywrightSteps(step.steps));
  }

  return flattened;
}

function normalizeConsoleEntries(
  entries: TestRunConsoleEntry[] | undefined,
): TestRunConsoleEntry[] {
  return (entries ?? []).slice(0, MAX_CONSOLE_ENTRIES).map((entry) => ({
    timestampMs: coerceNullableNumber(entry.timestampMs),
    type: truncate(firstNonEmpty(entry.type) ?? "log", 40),
    text: truncate(firstNonEmpty(entry.text) ?? "", 1000),
  }));
}

function normalizeNetworkEntries(
  entries: TestRunNetworkEntry[] | undefined,
): TestRunNetworkEntry[] {
  return (entries ?? []).slice(0, MAX_NETWORK_ENTRIES).map((entry) => ({
    timestampMs: coerceNullableNumber(entry.timestampMs),
    event:
      entry.event === "response" || entry.event === "requestfailed"
        ? entry.event
        : "request",
    method: firstNonEmpty(entry.method),
    url: truncate(firstNonEmpty(entry.url) ?? "", 1000),
    resourceType: firstNonEmpty(entry.resourceType),
    status: coerceNullableNumber(entry.status),
    failureText: firstNonEmpty(entry.failureText),
  }));
}

function buildSourceContext(
  source: string,
  errorMessage: string | null,
): TestRunSourceContext {
  const failureLine = findFailureLine(errorMessage);
  const lines = source.split(/\r?\n/);
  const excerpt = failureLine
    ? lines
        .slice(Math.max(0, failureLine - 7), Math.min(lines.length, failureLine + 6))
        .map((line, index) => {
          const lineNumber = Math.max(0, failureLine - 7) + index + 1;
          return `${String(lineNumber).padStart(4, " ")} | ${line}`;
        })
        .join("\n")
    : truncate(source, 6000);

  return {
    language: "typescript",
    excerpt,
    failureLine,
  };
}

function findFailureLine(errorMessage: string | null): number | null {
  const match = errorMessage?.match(/\.spec\.ts:(\d+):\d+/);
  if (!match) {
    return null;
  }

  const line = Number(match[1]);
  return Number.isInteger(line) && line > 0 ? line : null;
}

function resolveAttachmentPath(path: string, workDir: string): string {
  return isAbsolute(path) ? path : join(workDir, path);
}

function instrumentPlaywrightTestSource(source: string): string {
  return source
    .replace(
      /from\s+(['"])@playwright\/test\1/g,
      `from "./${STEP_RECORDER_FILE_NAME.replace(/\.ts$/, "")}"`,
    )
    .replace(
      /require\(\s*(['"])@playwright\/test\1\s*\)/g,
      `require("./${STEP_RECORDER_FILE_NAME.replace(/\.ts$/, "")}")`,
    );
}

function coerceNullableNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coercePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function coerceNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

function extractRepairFeedback(
  spec: PlaywrightSpec | undefined,
  result: PlaywrightCaseResult | undefined,
): TestRepairFeedback | undefined {
  if (!result) {
    return undefined;
  }

  const consoleLogs = normalizeFeedbackLines([
    ...readIoEntries(result.stdout, "stdout"),
    ...readIoEntries(result.stderr, "stderr"),
  ]);
  const browserObservations = normalizeFeedbackLines([
    spec?.title ? `Test: ${spec.title}` : null,
    ...collectStepObservations(result.steps),
  ]);

  if (consoleLogs.length === 0 && browserObservations.length === 0) {
    return undefined;
  }

  return {
    consoleLogs,
    browserObservations,
  };
}

function readIoEntries(
  entries: PlaywrightIoEntry[] | undefined,
  stream: "stdout" | "stderr",
): string[] {
  const lines: string[] = [];

  for (const entry of entries ?? []) {
    const text = readIoEntryText(entry);
    if (!text) {
      continue;
    }

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        lines.push(`${stream}: ${trimmed}`);
      }
    }
  }

  return lines;
}

function readIoEntryText(entry: PlaywrightIoEntry): string | null {
  if (typeof entry === "string") {
    return entry;
  }

  if (entry && typeof entry === "object") {
    if (typeof entry.text === "string") {
      return entry.text;
    }

    if (typeof entry.message === "string") {
      return entry.message;
    }

    if (typeof entry.buffer === "string") {
      try {
        return Buffer.from(entry.buffer, "base64").toString("utf8");
      } catch {
        return entry.buffer;
      }
    }
  }

  return null;
}

function collectStepObservations(steps: PlaywrightStep[] | undefined): string[] {
  const observations: string[] = [];

  for (const step of steps ?? []) {
    const title = firstNonEmpty(step.title);
    const error = step.error ? formatError(step.error) : null;

    if (title && error) {
      observations.push(`${title}: ${error}`);
    } else if (title) {
      observations.push(title);
    } else if (error) {
      observations.push(error);
    }

    observations.push(...collectStepObservations(step.steps));
  }

  return observations;
}

function normalizeFeedbackLines(values: Array<string | null | undefined>): string[] {
  const normalized = new Set<string>();

  for (const value of values) {
    const text = firstNonEmpty(value);
    if (text) {
      normalized.add(truncate(text, 300));
    }

    if (normalized.size >= 20) {
      break;
    }
  }

  return [...normalized];
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

async function ensureBrowserInstalledForRun(
  commandRunner: PlaywrightCommandRunner,
  workDir: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (commandRunner === defaultCommandRunner) {
    await ensurePlaywrightBrowserInstalled();
    return;
  }

  const result = await commandRunner(process.execPath, getPlaywrightInstallArgs(), {
    cwd: workDir,
    env,
    signal,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      meaningfulStderr(result.stderr) ??
        firstNonEmpty(result.stdout) ??
        "Failed to install Playwright Chromium browser.",
    );
  }
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
    const child = execFile(
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

    const abort = () => {
      child.kill();
    };

    if (options.signal?.aborted) {
      abort();
      return;
    }

    options.signal?.addEventListener("abort", abort, { once: true });
    child.once("exit", () => {
      options.signal?.removeEventListener("abort", abort);
    });
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
