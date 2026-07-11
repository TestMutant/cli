#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/config.ts
function resolveConfig(input = {}) {
  const apiKey = input.apiKey ?? process.env[API_KEY_ENV_VAR];
  const apiUrl = input.apiUrl ?? process.env[API_URL_ENV_VAR] ?? DEFAULT_API_URL;
  const timeoutMs = parseTimeout(input.timeout);
  if (!apiKey) {
    throw new CliError(
      `Missing API key. Set ${API_KEY_ENV_VAR} or pass --api-key.`,
      2
    );
  }
  return {
    apiKey,
    apiUrl: normalizeApiUrl(apiUrl),
    timeoutMs
  };
}
function normalizeApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`Invalid API URL: ${value}`, 2);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("API URL must start with http:// or https://.", 2);
  }
  return url.toString().replace(/\/$/, "");
}
function parseTimeout(value) {
  if (!value) {
    return 3e4;
  }
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliError("Timeout must be a positive integer in milliseconds.", 2);
  }
  return timeoutMs;
}
var DEFAULT_API_URL, API_KEY_ENV_VAR, API_URL_ENV_VAR, CliError;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    DEFAULT_API_URL = "https://api.testmutant.com";
    API_KEY_ENV_VAR = "TESTMUTANT_API_KEY";
    API_URL_ENV_VAR = "TESTMUTANT_API_URL";
    CliError = class extends Error {
      constructor(message, exitCode = 1) {
        super(message);
        this.exitCode = exitCode;
        this.name = "CliError";
        Object.setPrototypeOf(this, new.target.prototype);
      }
      exitCode;
    };
  }
});

// src/playwright-install.ts
async function ensurePlaywrightBrowserInstalled() {
  const runtimeRequire = (0, import_node_module.createRequire)(__filename);
  const playwrightCliPath = (0, import_node_path3.join)(
    (0, import_node_path3.dirname)(runtimeRequire.resolve("playwright/package.json")),
    "cli.js"
  );
  const args = process.platform === "linux" ? [playwrightCliPath, "install", "--with-deps", "chromium"] : [playwrightCliPath, "install", "chromium"];
  const result = await execNode(args);
  if (result.exitCode !== 0) {
    throw new CliError(
      result.stderr.trim() || result.stdout.trim() || "Failed to install Playwright Chromium browser."
    );
  }
}
function execNode(args) {
  return new Promise((resolve3) => {
    (0, import_node_child_process.execFile)(
      process.execPath,
      args,
      {
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const exitCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve3({ exitCode, stdout, stderr });
      }
    );
  });
}
var import_node_child_process, import_node_module, import_node_path3;
var init_playwright_install = __esm({
  "src/playwright-install.ts"() {
    "use strict";
    import_node_child_process = require("child_process");
    import_node_module = require("module");
    import_node_path3 = require("path");
    init_config();
  }
});

// src/runner-core/playwright-execution.ts
async function runPlaywrightTests(tests, options = {}) {
  const supported = tests.filter(isPlaywrightTest);
  const unsupported = tests.filter((test) => !isPlaywrightTest(test));
  const unsupportedResults = unsupported.map((test) => ({
    implementationId: test.implementationId,
    runnerKind: test.runnerKind,
    name: test.name,
    status: "Failed",
    errorMessage: `Unsupported runner kind: ${test.runnerKind}`,
    durationMs: null,
    screenshotBuffer: null,
    traceBuffer: null,
    videoBuffer: null
  }));
  if (supported.length === 0) {
    return summarize(options.baseUrl ?? null, unsupportedResults);
  }
  const workDir = await (0, import_promises2.mkdtemp)((0, import_node_path4.join)((0, import_node_os2.tmpdir)(), "testmutant-playwright-"));
  try {
    const writtenTests = await writePlaywrightWorkspace(
      workDir,
      supported,
      options
    );
    const commandRunner = options.commandRunner ?? defaultCommandRunner;
    const runtimeEnv = buildSterileRuntimeEnvironment();
    await ensureBrowserInstalledForRun(commandRunner, workDir, runtimeEnv, options.signal);
    const result = await commandRunner(
      process.execPath,
      getPlaywrightTestArgs(workDir, writtenTests),
      {
        cwd: workDir,
        env: runtimeEnv,
        signal: options.signal
      }
    );
    const mappedResults = await mapPlaywrightResults(
      writtenTests,
      result,
      workDir,
      options.captureRepairFeedback === true,
      options.captureStepEvidence === true
    );
    return summarize(options.baseUrl ?? null, [
      ...mappedResults,
      ...unsupportedResults
    ]);
  } finally {
    await (0, import_promises2.rm)(workDir, { recursive: true, force: true });
  }
}
function isPlaywrightTest(test) {
  return test.runnerKind.trim().toLowerCase() === PLAYWRIGHT_TYPE;
}
async function writePlaywrightWorkspace(workDir, tests, options) {
  const baseUrl = options.baseUrl ?? null;
  const perTestTimeoutMs = options.perTestTimeoutMs ?? 3e4;
  const traceMode = options.traceMode ?? "off";
  const videoMode = options.videoMode ?? "off";
  const captureStepEvidence = options.captureStepEvidence === true;
  await (0, import_promises2.writeFile)(
    (0, import_node_path4.join)(workDir, "playwright.config.cjs"),
    [
      "module.exports = {",
      `  timeout: ${perTestTimeoutMs},`,
      "  workers: 1,",
      "  use: {",
      `    baseURL: ${JSON.stringify(baseUrl)},`,
      options.storageStatePath ? `    storageState: ${JSON.stringify(options.storageStatePath)},` : "",
      "    screenshot: 'only-on-failure',",
      `    trace: '${traceMode}',`,
      `    video: '${videoMode}',`,
      "  },",
      `  outputDir: './test-results',`,
      "};",
      ""
    ].join("\n"),
    "utf8"
  );
  if (captureStepEvidence) {
    await (0, import_promises2.writeFile)(
      (0, import_node_path4.join)(workDir, STEP_RECORDER_FILE_NAME),
      createStepRecorderSource(baseUrl),
      "utf8"
    );
  }
  const writtenTests = [];
  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index];
    const fileName = `${String(index + 1).padStart(3, "0")}-${safeFilePart(
      test.implementationId
    )}.spec.ts`;
    const filePath = (0, import_node_path4.join)(workDir, fileName);
    const source = captureStepEvidence ? instrumentPlaywrightTestSource(test.source) : test.source;
    await (0, import_promises2.writeFile)(filePath, source, "utf8");
    writtenTests.push({ test, filePath, fileName });
  }
  return writtenTests;
}
async function mapPlaywrightResults(writtenTests, commandResult, workDir, captureRepairFeedback, captureStepEvidence) {
  const report = parsePlaywrightReport(commandResult.stdout);
  const fileResults = /* @__PURE__ */ new Map();
  const fallbackError = firstReportError(report) ?? meaningfulStderr(commandResult.stderr) ?? extractUsefulPlaywrightFailure(commandResult.stdout);
  if (report) {
    for (const suite of report.suites ?? []) {
      await collectSuiteResults(
        suite,
        writtenTests,
        fileResults,
        fallbackError,
        captureRepairFeedback,
        captureStepEvidence,
        workDir
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
      videoBuffer: null
    };
  });
}
async function collectSuiteResults(suite, writtenTests, fileResults, fallbackError, captureRepairFeedback, captureStepEvidence, workDir) {
  const fileName = suite.file ? suite.file.replace(/\\/g, "/").split("/").pop() : null;
  const writtenTest = fileName ? writtenTests.find((candidate) => candidate.fileName === fileName) : void 0;
  if (writtenTest && fileName) {
    const specs = suite.specs ?? [];
    const failedSpec = specs.find((spec) => spec.ok === false);
    const failedCase = specs.flatMap((spec) => spec.tests ?? []).find((testCase) => testCase.ok === false);
    const result = failedCase?.results?.find(
      (caseResult) => caseResult.status && caseResult.status !== "passed"
    );
    const primaryResult = result ?? specs.flatMap((spec) => spec.tests ?? []).flatMap((testCase) => testCase.results ?? []).find(Boolean);
    const isFailed = Boolean(failedSpec || failedCase);
    let screenshotBuffer = null;
    let traceBuffer = null;
    let videoBuffer = null;
    if (primaryResult) {
      traceBuffer = await readAttachmentByName(primaryResult, "trace", workDir);
      videoBuffer = await readAttachmentByName(primaryResult, "video", workDir);
    }
    if (isFailed && result) {
      screenshotBuffer = await readScreenshotAttachment(result, workDir);
    }
    const repairFeedback = captureRepairFeedback && isFailed ? extractRepairFeedback(failedSpec, result) : void 0;
    const evidence = captureStepEvidence && primaryResult ? await readStepEvidence(
      primaryResult,
      workDir,
      writtenTest.test.source,
      formatResultError(result) ?? fallbackError
    ) : void 0;
    fileResults.set(fileName, {
      implementationId: writtenTest.test.implementationId,
      runnerKind: writtenTest.test.runnerKind,
      name: writtenTest.test.name,
      status: isFailed ? "Failed" : "Passed",
      errorMessage: isFailed ? formatResultError(result) ?? fallbackError ?? "Playwright test failed." : null,
      durationMs: sumDurations(specs),
      screenshotBuffer,
      traceBuffer,
      videoBuffer,
      ...repairFeedback ? { repairFeedback } : {},
      ...evidence ? { evidence } : {}
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
      workDir
    );
  }
}
async function readScreenshotAttachment(result, workDir) {
  return readAttachmentByName(result, "screenshot", workDir);
}
async function readAttachmentByName(result, name, workDir) {
  const attachment = result.attachments?.find(
    (a) => a.name === name && a.path
  );
  if (!attachment?.path) {
    return null;
  }
  try {
    return await (0, import_promises2.readFile)(resolveAttachmentPath(attachment.path, workDir));
  } catch {
    return null;
  }
}
async function readStepEvidence(result, workDir, source, errorMessage) {
  const recorderEvidence = await readRecorderEvidence(result, workDir);
  const sourceContext = buildSourceContext(source, errorMessage);
  if (recorderEvidence) {
    return {
      schemaVersion: 1,
      source: "testmutant-playwright-step-snapshot",
      steps: await buildRecordedEvidenceSteps(result, recorderEvidence, workDir),
      console: {
        entries: normalizeConsoleEntries(recorderEvidence.console?.entries),
        capped: recorderEvidence.console?.capped === true
      },
      network: {
        entries: normalizeNetworkEntries(recorderEvidence.network?.entries),
        capped: recorderEvidence.network?.capped === true
      },
      sourceContext,
      caps: {
        maxSteps: recorderEvidence.caps?.maxSteps ?? MAX_EVIDENCE_STEPS,
        maxConsoleEntries: recorderEvidence.caps?.maxConsoleEntries ?? MAX_CONSOLE_ENTRIES,
        maxNetworkEntries: recorderEvidence.caps?.maxNetworkEntries ?? MAX_NETWORK_ENTRIES
      },
      redaction: {
        headers: recorderEvidence.redaction?.headers ?? [
          "authorization",
          "cookie",
          "set-cookie",
          "x-api-key"
        ],
        queryParameters: recorderEvidence.redaction?.queryParameters ?? [
          "token",
          "secret",
          "password",
          "key",
          "code",
          "state",
          "session"
        ],
        logs: recorderEvidence.redaction?.logs ?? true,
        screenshots: recorderEvidence.redaction?.screenshots ?? "Sensitive input fields are masked before screenshot capture where selectors can be detected."
      },
      reporterFallback: false
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
      maxNetworkEntries: MAX_NETWORK_ENTRIES
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
        "session"
      ],
      logs: true,
      screenshots: "No step screenshots were captured from reporter step data."
    },
    reporterFallback: true
  };
}
async function readRecorderEvidence(result, workDir) {
  const attachment = result.attachments?.find(
    (a) => a.name === EVIDENCE_ATTACHMENT_NAME && a.path
  );
  if (!attachment?.path) {
    return null;
  }
  try {
    return JSON.parse(
      await (0, import_promises2.readFile)(resolveAttachmentPath(attachment.path, workDir), "utf8")
    );
  } catch {
    return null;
  }
}
async function buildRecordedEvidenceSteps(result, evidence, workDir) {
  const steps = [];
  for (const [position, step] of (evidence.steps ?? []).entries()) {
    if (steps.length >= MAX_EVIDENCE_STEPS) {
      break;
    }
    const screenshotBuffer = step.screenshotAttachmentName ? await readAttachmentByName(result, step.screenshotAttachmentName, workDir) : null;
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
      networkEndIndex: coerceNonNegativeInt(step.networkEndIndex, 0)
    });
  }
  return steps;
}
function buildReporterEvidenceSteps(steps) {
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
    networkEndIndex: 0
  }));
}
function flattenPlaywrightSteps(steps) {
  const flattened = [];
  for (const step of steps ?? []) {
    if (step.category === "test.step") {
      flattened.push(step);
    }
    flattened.push(...flattenPlaywrightSteps(step.steps));
  }
  return flattened;
}
function normalizeConsoleEntries(entries) {
  return (entries ?? []).slice(0, MAX_CONSOLE_ENTRIES).map((entry) => ({
    timestampMs: coerceNullableNumber(entry.timestampMs),
    type: truncate(firstNonEmpty(entry.type) ?? "log", 40),
    text: truncate(firstNonEmpty(entry.text) ?? "", 1e3)
  }));
}
function normalizeNetworkEntries(entries) {
  return (entries ?? []).slice(0, MAX_NETWORK_ENTRIES).map((entry) => ({
    timestampMs: coerceNullableNumber(entry.timestampMs),
    event: entry.event === "response" || entry.event === "requestfailed" ? entry.event : "request",
    method: firstNonEmpty(entry.method),
    url: truncate(firstNonEmpty(entry.url) ?? "", 1e3),
    resourceType: firstNonEmpty(entry.resourceType),
    status: coerceNullableNumber(entry.status),
    failureText: firstNonEmpty(entry.failureText)
  }));
}
function buildSourceContext(source, errorMessage) {
  const failureLine = findFailureLine(errorMessage);
  const lines = source.split(/\r?\n/);
  const excerpt = failureLine ? lines.slice(Math.max(0, failureLine - 7), Math.min(lines.length, failureLine + 6)).map((line, index) => {
    const lineNumber = Math.max(0, failureLine - 7) + index + 1;
    return `${String(lineNumber).padStart(4, " ")} | ${line}`;
  }).join("\n") : truncate(source, 6e3);
  return {
    language: "typescript",
    excerpt,
    failureLine
  };
}
function findFailureLine(errorMessage) {
  const match = errorMessage?.match(/\.spec\.ts:(\d+):\d+/);
  if (!match) {
    return null;
  }
  const line = Number(match[1]);
  return Number.isInteger(line) && line > 0 ? line : null;
}
function resolveAttachmentPath(path, workDir) {
  return (0, import_node_path4.isAbsolute)(path) ? path : (0, import_node_path4.join)(workDir, path);
}
function instrumentPlaywrightTestSource(source) {
  return source.replace(
    /from\s+(['"])@playwright\/test\1/g,
    `from "./${STEP_RECORDER_FILE_NAME.replace(/\.ts$/, "")}"`
  ).replace(
    /require\(\s*(['"])@playwright\/test\1\s*\)/g,
    `require("./${STEP_RECORDER_FILE_NAME.replace(/\.ts$/, "")}")`
  );
}
function createStepRecorderSource(baseUrl) {
  const allowedOrigins = baseUrl ? (() => {
    try {
      return [new URL(baseUrl).origin];
    } catch {
      return [];
    }
  })() : [];
  return TESTMUTANT_STEP_RECORDER_SOURCE.replace(
    "__TESTMUTANT_ALLOWED_ORIGINS__",
    JSON.stringify(allowedOrigins)
  );
}
function coerceNullableNumber(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function coercePositiveInt(value, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function coerceNonNegativeInt(value, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
function parsePlaywrightReport(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
function firstReportError(report) {
  const error = report?.errors?.find(
    (candidate) => Boolean(candidate.message ?? candidate.stack)
  );
  return error ? formatError(error) : null;
}
function formatResultError(result) {
  if (!result) {
    return null;
  }
  const error = result.error ?? result.errors?.[0];
  return error ? formatError(error) : null;
}
function formatError(error) {
  return truncate(firstNonEmpty(error.message, error.stack) ?? "Playwright test failed.");
}
function sumDurations(specs) {
  const duration = specs.flatMap((spec) => spec.tests ?? []).flatMap((testCase) => testCase.results ?? []).reduce((total, result) => total + (result.duration ?? 0), 0);
  return duration > 0 ? duration : null;
}
function extractRepairFeedback(spec, result) {
  if (!result) {
    return void 0;
  }
  const consoleLogs = normalizeFeedbackLines([
    ...readIoEntries(result.stdout, "stdout"),
    ...readIoEntries(result.stderr, "stderr")
  ]);
  const browserObservations = normalizeFeedbackLines([
    spec?.title ? `Test: ${spec.title}` : null,
    ...collectStepObservations(result.steps)
  ]);
  if (consoleLogs.length === 0 && browserObservations.length === 0) {
    return void 0;
  }
  return {
    consoleLogs,
    browserObservations
  };
}
function readIoEntries(entries, stream) {
  const lines = [];
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
function readIoEntryText(entry) {
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
function collectStepObservations(steps) {
  const observations = [];
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
function normalizeFeedbackLines(values) {
  const normalized = /* @__PURE__ */ new Set();
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
function summarize(baseUrl, tests) {
  const passed = tests.filter((test) => test.status === "Passed").length;
  const failed = tests.length - passed;
  return {
    kind: "playwright",
    baseUrl,
    total: tests.length,
    passed,
    failed,
    tests
  };
}
function getPlaywrightCliPath() {
  const runtimeRequire = (0, import_node_module2.createRequire)(__filename);
  return (0, import_node_path4.join)((0, import_node_path4.dirname)(runtimeRequire.resolve("playwright/package.json")), "cli.js");
}
function buildNodePath(existing) {
  const runtimeRequire = (0, import_node_module2.createRequire)(__filename);
  const dependencyPath = (0, import_node_path4.dirname)(
    (0, import_node_path4.dirname)((0, import_node_path4.dirname)(runtimeRequire.resolve("@playwright/test")))
  );
  return existing ? `${dependencyPath}${delimiter()}${existing}` : dependencyPath;
}
function buildSterileRuntimeEnvironment() {
  const values = {
    NODE_PATH: buildNodePath(process.env.NODE_PATH)
  };
  for (const name of [
    "PATH",
    "Path",
    "SYSTEMROOT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "PLAYWRIGHT_BROWSERS_PATH"
  ]) {
    const value = process.env[name];
    if (value) {
      values[name] = value;
    }
  }
  return values;
}
function getPlaywrightInstallArgs() {
  if (process.platform === "linux") {
    return [getPlaywrightCliPath(), "install", "--with-deps", "chromium"];
  }
  return [getPlaywrightCliPath(), "install", "chromium"];
}
async function ensureBrowserInstalledForRun(commandRunner, workDir, env, signal) {
  if (commandRunner === defaultCommandRunner) {
    await ensurePlaywrightBrowserInstalled();
    return;
  }
  const result = await commandRunner(process.execPath, getPlaywrightInstallArgs(), {
    cwd: workDir,
    env,
    signal
  });
  if (result.exitCode !== 0) {
    throw new Error(
      meaningfulStderr(result.stderr) ?? firstNonEmpty(result.stdout) ?? "Failed to install Playwright Chromium browser."
    );
  }
}
function getPlaywrightTestArgs(workDir, writtenTests) {
  return [
    getPlaywrightCliPath(),
    "test",
    "--config",
    (0, import_node_path4.join)(workDir, "playwright.config.cjs"),
    "--reporter=json",
    ...writtenTests.map((writtenTest) => writtenTest.fileName)
  ];
}
function meaningfulStderr(stderr) {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => {
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
function extractUsefulPlaywrightFailure(stdout) {
  const report = parsePlaywrightReport(stdout);
  if (!report) {
    return firstNonEmpty(stdout);
  }
  const errors = [];
  for (const suite of report.suites ?? []) {
    collectFailureMessages(suite, errors);
  }
  return errors.length > 0 ? truncate(errors.join("\n\n")) : null;
}
function collectFailureMessages(suite, errors) {
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
function delimiter() {
  return process.platform === "win32" ? ";" : ":";
}
function defaultCommandRunner(command, args, options) {
  return new Promise((resolve3) => {
    const child = (0, import_node_child_process2.execFile)(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const exitCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve3({
          exitCode,
          stdout,
          stderr
        });
      }
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
function safeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "test";
}
function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return truncate(trimmed);
    }
  }
  return null;
}
function truncate(value, maxLength = 1e3) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
var import_node_child_process2, import_promises2, import_node_os2, import_node_path4, import_node_module2, PLAYWRIGHT_TYPE, EVIDENCE_ATTACHMENT_NAME, MAX_EVIDENCE_STEPS, MAX_CONSOLE_ENTRIES, MAX_NETWORK_ENTRIES, STEP_RECORDER_FILE_NAME, TESTMUTANT_STEP_RECORDER_SOURCE;
var init_playwright_execution = __esm({
  "src/runner-core/playwright-execution.ts"() {
    "use strict";
    import_node_child_process2 = require("child_process");
    import_promises2 = require("fs/promises");
    import_node_os2 = require("os");
    import_node_path4 = require("path");
    init_playwright_install();
    import_node_module2 = require("module");
    PLAYWRIGHT_TYPE = "playwright";
    EVIDENCE_ATTACHMENT_NAME = "testmutant-evidence";
    MAX_EVIDENCE_STEPS = 60;
    MAX_CONSOLE_ENTRIES = 100;
    MAX_NETWORK_ENTRIES = 120;
    STEP_RECORDER_FILE_NAME = "testmutant-step-recorder.ts";
    TESTMUTANT_STEP_RECORDER_SOURCE = String.raw`
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
const ALLOWED_ORIGINS = __TESTMUTANT_ALLOWED_ORIGINS__;

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

    await page.route("**/*", async (route) => {
      try {
        if (ALLOWED_ORIGINS.includes(new URL(route.request().url()).origin)) {
          await route.continue();
          return;
        }
      } catch {
      }
      await route.abort("blockedbyclient");
    });
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
  }
});

// src/playwright-runner.ts
var init_playwright_runner = __esm({
  "src/playwright-runner.ts"() {
    "use strict";
    init_playwright_execution();
  }
});

// src/agent-runner.ts
var agent_runner_exports = {};
__export(agent_runner_exports, {
  buildAgentWebSocketUrl: () => buildAgentWebSocketUrl,
  buildHostedAgentWebSocketUrl: () => buildHostedAgentWebSocketUrl,
  runAgentGeneration: () => runAgentGeneration
});
function buildAgentWebSocketUrl(apiUrl, runId) {
  const url = new URL(
    `/api/cli/v1/runs/${encodeURIComponent(runId)}/agent/ws`,
    apiUrl
  );
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new CliError(`Unsupported TestMutant API URL protocol: ${url.protocol}`);
  }
  return url.toString();
}
function buildHostedAgentWebSocketUrl(apiUrl, projectId, runId) {
  const url = new URL(
    `/api/cli/v1/hosted-runner/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/agent/ws`,
    apiUrl
  );
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new CliError(`Unsupported TestMutant API URL protocol: ${url.protocol}`);
  }
  return url.toString();
}
async function runAgentGeneration(options) {
  const browserDriver = options.browserDriver ?? await createDirectPlaywrightDriver(options.baseUrl ?? null);
  try {
    return await runAgentWebSocketLoop(options, browserDriver);
  } finally {
    await browserDriver.close();
  }
}
async function runAgentWebSocketLoop(options, browserDriver) {
  const webSocketFactory = options.webSocketFactory ?? createDefaultWebSocket;
  const socket = webSocketFactory(options.webSocketUrl ?? buildAgentWebSocketUrl(options.apiUrl, options.runId), {
    handshakeTimeout: options.timeoutMs,
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "user-agent": options.userAgent
    }
  });
  let settled = false;
  let activeToolCalls = 0;
  let closeAfterToolCalls = false;
  let generationResult = null;
  await new Promise((resolve3, reject) => {
    const timeout2 = setTimeout(() => {
      fail(new CliError(`TestMutant agent generation timed out after ${options.timeoutMs} ms.`));
    }, options.timeoutMs);
    const finish = () => {
      if (settled || activeToolCalls > 0) {
        closeAfterToolCalls = true;
        return;
      }
      settled = true;
      clearTimeout(timeout2);
      socket.close();
      resolve3();
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout2);
      socket.close();
      reject(error);
    };
    socket.on("open", () => {
      sendJson2(socket, { type: "runner_ready" });
    });
    socket.on("message", (data) => {
      void handleMessage(data).catch(fail);
    });
    socket.on("error", (error) => {
      fail(new CliError(`TestMutant agent websocket failed. ${error.message}`));
    });
    socket.on("close", (_code, reason) => {
      if (!settled && activeToolCalls === 0) {
        settled = true;
        clearTimeout(timeout2);
        resolve3();
        return;
      }
      closeAfterToolCalls = true;
      void reason;
    });
    async function handleMessage(data) {
      const message = parseAgentMessage(data);
      if (message.type === "agent_complete") {
        generationResult = {
          testImplementationId: typeof message.testImplementationId === "string" ? message.testImplementationId : null,
          name: typeof message.name === "string" ? message.name : null,
          sourceLength: typeof message.sourceLength === "number" ? message.sourceLength : null,
          attemptCount: typeof message.attemptCount === "number" ? message.attemptCount : 0,
          validationSummary: parseValidationSummary(message.validationSummary)
        };
        finish();
        return;
      }
      if (message.type === "error") {
        fail(new CliError(formatApiError(message.message)));
        return;
      }
      activeToolCalls += 1;
      try {
        await handleToolCall(socket, browserDriver, message);
      } finally {
        activeToolCalls -= 1;
        if (closeAfterToolCalls && activeToolCalls === 0) {
          finish();
        }
      }
    }
  });
  return generationResult ?? {
    testImplementationId: null,
    name: null,
    sourceLength: null,
    attemptCount: 0,
    validationSummary: null
  };
}
async function handleToolCall(socket, browserDriver, message) {
  if (!SUPPORTED_TOOLS.has(message.name)) {
    sendJson2(socket, {
      type: "tool_result",
      id: message.id,
      ok: false,
      error: `Unsupported browser tool: ${message.name}`,
      observation: {}
    });
    return;
  }
  const args = normalizeArguments(message.arguments);
  try {
    const observation = await browserDriver.callTool(message.name, args);
    if (isToolErrorObservation(observation)) {
      sendJson2(socket, {
        type: "tool_result",
        id: message.id,
        ok: false,
        error: extractObservationError(observation),
        observation: normalizeObservation(observation)
      });
      return;
    }
    sendJson2(socket, {
      type: "tool_result",
      id: message.id,
      ok: true,
      observation: normalizeObservation(observation)
    });
  } catch (error) {
    sendJson2(socket, {
      type: "tool_result",
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      observation: {}
    });
  }
}
async function createDirectPlaywrightDriver(baseUrl) {
  await ensurePlaywrightBrowserInstalled();
  const browser = await import_playwright2.chromium.launch({ headless: true });
  const page = await browser.newPage();
  return {
    async callTool(name, args) {
      switch (name) {
        case "browser_navigate": {
          const url = getRequiredString(args, "url");
          await page.goto(url, { waitUntil: "domcontentloaded" });
          return await snapshotPage(page);
        }
        case "browser_snapshot":
          return await snapshotPage(page);
        case "browser_click": {
          const selector = getRequiredString(args, "selector");
          await page.click(selector);
          return await snapshotPage(page);
        }
        case "browser_type": {
          const selector = getRequiredString(args, "selector");
          const text = typeof args.text === "string" ? args.text : "";
          await page.fill(selector, text);
          return await snapshotPage(page);
        }
        case "browser_evaluate": {
          const expression = getRequiredString(args, "expression");
          const result = await page.evaluate(expression);
          return {
            url: page.url(),
            title: await page.title(),
            result
          };
        }
        case "playwright_validate_test": {
          const draftName = getRequiredString(args, "name");
          const source = getRequiredString(args, "source");
          const summary = await runPlaywrightTests(
            [
              {
                implementationId: "generated-draft",
                testSpecId: "generated-draft",
                testLayer: "EndToEnd",
                runnerKind: "playwright",
                name: draftName,
                source
              }
            ],
            { baseUrl }
          );
          return {
            passed: summary.failed === 0 && summary.total > 0,
            kind: summary.kind,
            summary: {
              total: summary.total,
              passed: summary.passed,
              failed: summary.failed,
              baseUrl: summary.baseUrl
            },
            tests: summary.tests.map(toValidationTestResult),
            failureExcerpt: summary.tests.find((test) => test.status === "Failed")?.errorMessage ?? null
          };
        }
        default:
          throw new Error(`Unsupported browser tool: ${name}`);
      }
    },
    async close() {
      await browser.close();
    }
  };
}
async function snapshotPage(page) {
  return {
    url: page.url(),
    title: await page.title(),
    text: await page.locator("body").innerText().catch(() => "")
  };
}
function getRequiredString(args, key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Browser tool argument '${key}' is required.`);
  }
  return value;
}
function createDefaultWebSocket(url, options) {
  return new import_ws.default(url, options);
}
function parseAgentMessage(data) {
  const raw = typeof data === "string" || Buffer.isBuffer(data) ? data.toString() : data instanceof ArrayBuffer ? Buffer.from(data).toString() : String(data);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("TestMutant agent sent invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CliError("TestMutant agent sent an invalid message.");
  }
  const message = parsed;
  if (message.type === "tool_call") {
    const toolCall = parsed;
    if (typeof toolCall.id !== "string" || typeof toolCall.name !== "string") {
      throw new CliError("TestMutant agent sent an invalid tool call.");
    }
    return {
      type: "tool_call",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments
    };
  }
  if (message.type === "agent_complete" || message.type === "error") {
    return parsed;
  }
  throw new CliError("TestMutant agent sent an unsupported message.");
}
function parseValidationSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const summary = value;
  if (typeof summary.kind !== "string" || typeof summary.total !== "number" || typeof summary.passed !== "number" || typeof summary.failed !== "number" || !Array.isArray(summary.tests)) {
    return null;
  }
  return {
    kind: "playwright",
    baseUrl: typeof summary.baseUrl === "string" ? summary.baseUrl : null,
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    tests: summary.tests.filter((item) => Boolean(item && typeof item === "object")).map((item) => ({
      implementationId: typeof item.implementationId === "string" ? item.implementationId : typeof item.testId === "string" ? item.testId : "",
      runnerKind: typeof item.runnerKind === "string" ? item.runnerKind : typeof item.type === "string" ? item.type : "",
      name: typeof item.name === "string" ? item.name : "",
      status: item.status === "Passed" ? "Passed" : "Failed",
      errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : null,
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      screenshotBuffer: null,
      traceBuffer: null,
      videoBuffer: null
    }))
  };
}
function toValidationTestResult(test) {
  return {
    testId: test.implementationId,
    implementationId: test.implementationId,
    type: test.runnerKind,
    runnerKind: test.runnerKind,
    name: test.name,
    status: test.status,
    errorMessage: test.errorMessage,
    durationMs: test.durationMs
  };
}
function normalizeArguments(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}
function normalizeObservation(value) {
  if (value === void 0) {
    return {};
  }
  return JSON.parse(JSON.stringify(value));
}
function isToolErrorObservation(value) {
  return Boolean(
    value && typeof value === "object" && "isError" in value && value.isError === true
  );
}
function extractObservationError(value) {
  if (!value || typeof value !== "object" || !("content" in value)) {
    return "Browser tool execution failed.";
  }
  const content = value.content;
  if (!Array.isArray(content)) {
    return "Browser tool execution failed.";
  }
  const text = content.map(
    (item) => item && typeof item === "object" && "type" in item && "text" in item && item.type === "text" && typeof item.text === "string" ? item.text : null
  ).filter((item) => Boolean(item?.trim())).join("\n");
  return text || "Browser tool execution failed.";
}
function sendJson2(socket, value) {
  socket.send(JSON.stringify(value));
}
function formatApiError(message) {
  return typeof message === "string" && message.trim() ? message : "TestMutant agent generation failed.";
}
var import_playwright2, import_ws, SUPPORTED_TOOLS;
var init_agent_runner = __esm({
  "src/agent-runner.ts"() {
    "use strict";
    import_playwright2 = require("playwright");
    init_config();
    init_playwright_install();
    import_ws = __toESM(require("ws"));
    init_playwright_runner();
    SUPPORTED_TOOLS = /* @__PURE__ */ new Set([
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_evaluate",
      "playwright_validate_test"
    ]);
  }
});

// src/index.ts
var import_config8 = require("dotenv/config");
var import_node_fs3 = require("fs");
var import_node_path8 = require("path");

// src/runner-service/config.ts
var import_node_crypto = require("crypto");
var import_node_path = require("path");
var import_node_os = require("os");
function resolveRunnerServiceConfig(options, version) {
  return {
    host: options.host ?? process.env.TESTMUTANT_RUNNER_HOST ?? "0.0.0.0",
    port: parseIntOption(options.port ?? process.env.TESTMUTANT_RUNNER_PORT, 8080),
    token: nonEmpty(options.token ?? process.env.TESTMUTANT_RUNNER_TOKEN),
    runnerInstanceId: nonEmpty(options.runnerInstanceId ?? process.env.TESTMUTANT_RUNNER_INSTANCE_ID) ?? stableLocalRunnerId(),
    artifactDir: nonEmpty(options.artifactDir ?? process.env.TESTMUTANT_RUNNER_ARTIFACT_DIR) ?? (0, import_node_path.join)((0, import_node_os.tmpdir)(), "testmutant-runner-artifacts"),
    maxSessions: parseIntOption(
      options.maxSessions ?? process.env.TESTMUTANT_RUNNER_MAX_SESSIONS,
      1
    ),
    sessionTimeoutMs: parseIntOption(
      options.sessionTimeoutMs ?? process.env.TESTMUTANT_RUNNER_SESSION_TIMEOUT_MS,
      18e5
    ),
    headless: parseBooleanOption(
      options.headless ?? process.env.TESTMUTANT_RUNNER_HEADLESS,
      true
    ),
    version
  };
}
function parseIntOption(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function parseBooleanOption(value, fallback) {
  if (!value?.trim()) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(value.trim().toLowerCase())) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value.trim().toLowerCase())) {
    return false;
  }
  return fallback;
}
function nonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed || null;
}
function stableLocalRunnerId() {
  return `local-${(0, import_node_crypto.randomUUID)()}`;
}

// src/runner-service/server.ts
var import_node_http = require("http");

// src/runner-service/routes.ts
var import_node_crypto2 = require("crypto");

// src/runner-core/artifacts.ts
var import_promises = require("fs/promises");
var import_node_path2 = require("path");
function resolveArtifactDirectory(artifactRoot, sessionId, requestedDirectory) {
  const root = (0, import_node_path2.resolve)(artifactRoot);
  const fallback = (0, import_node_path2.resolve)(root, sessionId);
  if (!requestedDirectory?.trim()) {
    return fallback;
  }
  const requested = (0, import_node_path2.isAbsolute)(requestedDirectory) ? (0, import_node_path2.resolve)(requestedDirectory) : (0, import_node_path2.resolve)(root, requestedDirectory);
  return isSubpath(root, requested) ? requested : fallback;
}
async function writeArtifact(artifactDirectory, kind, preferredFileName, contentType, data) {
  await (0, import_promises.mkdir)(artifactDirectory, { recursive: true });
  const fileName = safeFileName(preferredFileName, defaultExtension(contentType));
  const path = (0, import_node_path2.join)(artifactDirectory, fileName);
  await (0, import_promises.writeFile)(path, data);
  const sizeBytes = (await (0, import_promises.stat)(path)).size;
  return {
    kind,
    path,
    fileName,
    contentType,
    sizeBytes
  };
}
function safeFileName(value, extension) {
  const candidate = (0, import_node_path2.basename)(value?.trim() || `artifact-${Date.now()}${extension}`);
  const sanitized = candidate.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128);
  return sanitized || `artifact-${Date.now()}${extension}`;
}
function artifactKindFromAttachment(name) {
  if (name === "trace") {
    return { kind: "trace", extension: ".zip", contentType: "application/zip" };
  }
  if (name === "video") {
    return { kind: "video", extension: ".webm", contentType: "video/webm" };
  }
  return { kind: "screenshot", extension: ".png", contentType: "image/png" };
}
function defaultExtension(contentType) {
  if (contentType === "image/png") {
    return ".png";
  }
  if (contentType === "application/zip") {
    return ".zip";
  }
  if (contentType === "video/webm") {
    return ".webm";
  }
  return (0, import_node_path2.extname)(contentType) || ".bin";
}
function isSubpath(parent, child) {
  const normalizedParent = parent.endsWith("\\") ? parent : `${parent}\\`;
  return child === parent || child.startsWith(normalizedParent);
}

// src/runner-core/playwright-runner-adapter.ts
var import_node_path5 = require("path");
init_playwright_execution();

// src/runner-core/generated-source-policy.ts
var import_typescript = __toESM(require("typescript"));
var ALLOWED_IMPORT = "@playwright/test";
var FORBIDDEN_IDENTIFIERS = /* @__PURE__ */ new Set([
  "process",
  "require",
  "eval",
  "Function",
  "fetch",
  "WebSocket",
  "Bun",
  "Deno"
]);
function validateGeneratedPlaywrightSource(source, explicitSecrets = []) {
  if (!source.trim()) {
    return { valid: false, error: "Generated Playwright source is required." };
  }
  for (const secret of explicitSecrets) {
    if (secret && source.includes(secret)) {
      return { valid: false, error: "Generated source contains a protected credential value." };
    }
  }
  const file = import_typescript.default.createSourceFile(
    "generated.spec.ts",
    source,
    import_typescript.default.ScriptTarget.ES2022,
    true,
    import_typescript.default.ScriptKind.TS
  );
  const parseDiagnostics = file.parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    return { valid: false, error: "Generated Playwright source has TypeScript syntax errors." };
  }
  let importCount = 0;
  let error = null;
  const reject = (message) => {
    error ??= message;
  };
  const visit = (node) => {
    if (import_typescript.default.isImportDeclaration(node)) {
      importCount += 1;
      if (!import_typescript.default.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== ALLOWED_IMPORT) {
        reject(`Only '${ALLOWED_IMPORT}' may be imported by generated tests.`);
      }
    }
    if (import_typescript.default.isImportEqualsDeclaration(node)) {
      reject("Generated tests may not use import-equals declarations.");
    }
    if (import_typescript.default.isCallExpression(node) && node.expression.kind === import_typescript.default.SyntaxKind.ImportKeyword) {
      reject("Generated tests may not use dynamic imports.");
    }
    if (import_typescript.default.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      reject(`Generated tests may not use '${node.text}'.`);
    }
    if (import_typescript.default.isPropertyAccessExpression(node) && import_typescript.default.isIdentifier(node.expression) && node.expression.text === "page" && (node.name.text === "context" || node.name.text === "request")) {
      reject("Generated tests may not access browser context, cookies, or request clients.");
    }
    import_typescript.default.forEachChild(node, visit);
  };
  visit(file);
  if (error) {
    return { valid: false, error };
  }
  if (importCount !== 1 || !/\btest\s*\(/.test(source)) {
    return {
      valid: false,
      error: "Generated source must import '@playwright/test' and define a Playwright test."
    };
  }
  return { valid: true };
}

// src/runner-core/playwright-runner-adapter.ts
async function executeRunnerTests(request, options) {
  const summary = await runPlaywrightTests(
    request.tests.map(toCoreTestDefinition),
    {
      baseUrl: request.baseUrl,
      storageStatePath: options.storageStatePath,
      perTestTimeoutMs: toNumber(request.perTestTimeoutMs) ?? void 0,
      traceMode: options.traceMode ?? "retain-on-failure",
      videoMode: options.videoMode ?? "retain-on-failure",
      captureRepairFeedback: true,
      captureStepEvidence: true,
      signal: executionSignal(options.signal, request.runTimeoutMs)
    }
  );
  return toRunnerSummary(summary, request.tests, options.artifactDirectory);
}
function executionSignal(signal, runTimeoutMs) {
  const parsed = toNumber(runTimeoutMs);
  if (!parsed) return signal;
  const timeoutSignal = AbortSignal.timeout(parsed);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
async function validateDraftPlaywrightTest(request, options) {
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
        tests: []
      },
      failureExcerpt: policy.error,
      artifacts: [],
      failureClassification: "test_code"
    };
  }
  const test = {
    testId: "generated-draft",
    testSpecId: null,
    name: request.name,
    runnerKind: "playwright",
    source: request.source,
    metadata: null
  };
  const summary = await executeRunnerTests(
    {
      baseUrl: request.baseUrl,
      environment: null,
      tests: [test],
      perTestTimeoutMs: request.timeoutMs,
      runTimeoutMs: null,
      artifactDirectory: null
    },
    options
  );
  const failure = summary.tests.find(
    (candidate) => candidate.status !== "Passed"
  );
  return {
    passed: toNumber(summary.failed) === 0 && toNumber(summary.errored) === 0 && (toNumber(summary.total) ?? 0) > 0,
    summary,
    failureExcerpt: failure?.errorMessage ?? null,
    artifacts: summary.tests.flatMap((candidate) => candidate.artifacts),
    failureClassification: failure ? classifyFailure(failure.errorMessage) : null
  };
}
function classifyFailure(message) {
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
async function toRunnerSummary(summary, definitions, artifactDirectory) {
  const definitionById = new Map(definitions.map((test) => [test.testId, test]));
  const tests = await Promise.all(
    summary.tests.map(
      (test) => toRunnerTestResult(test, definitionById.get(test.implementationId), artifactDirectory)
    )
  );
  return {
    kind: "playwright",
    baseUrl: summary.baseUrl,
    total: summary.total,
    passed: summary.passed,
    failed: tests.filter((test) => test.status === "Failed").length,
    skipped: tests.filter((test) => test.status === "Skipped").length,
    errored: tests.filter((test) => test.status === "Errored").length,
    tests
  };
}
async function toRunnerTestResult(test, definition, artifactDirectory) {
  return {
    testId: test.implementationId,
    testSpecId: definition?.testSpecId ?? null,
    name: test.name,
    runnerKind: test.runnerKind,
    status: test.status,
    durationMs: test.durationMs,
    errorMessage: test.errorMessage,
    repairFeedback: test.repairFeedback ?? null,
    artifacts: await writeTestArtifacts(test, artifactDirectory)
  };
}
async function writeTestArtifacts(test, artifactDirectory) {
  const artifacts = [];
  const prefix = test.implementationId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "test";
  for (const [name, buffer] of [
    ["screenshot", test.screenshotBuffer],
    ["trace", test.traceBuffer],
    ["video", test.videoBuffer]
  ]) {
    if (!buffer) {
      continue;
    }
    const descriptor = artifactKindFromAttachment(name);
    artifacts.push(
      await writeArtifact(
        (0, import_node_path5.join)(artifactDirectory, prefix),
        descriptor.kind,
        `${prefix}-${descriptor.kind}${descriptor.extension}`,
        descriptor.contentType,
        buffer
      )
    );
  }
  if (test.status !== "Passed" && (test.repairFeedback || test.evidence)) {
    artifacts.push(
      await writeArtifact(
        (0, import_node_path5.join)(artifactDirectory, prefix),
        "structured_report",
        `${prefix}-execution-evidence.json`,
        "application/json",
        Buffer.from(JSON.stringify({
          schemaVersion: 1,
          repairFeedback: test.repairFeedback ?? null,
          evidence: test.evidence ?? null
        }))
      )
    );
  }
  return artifacts;
}
function toCoreTestDefinition(test) {
  return {
    implementationId: test.testId,
    testSpecId: test.testSpecId,
    runnerKind: test.runnerKind,
    name: test.name,
    source: test.source
  };
}
function toNumber(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// src/runner-service/errors.ts
var RunnerHttpError = class extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "RunnerHttpError";
  }
  statusCode;
  code;
};
function isTimeoutError(error) {
  return error instanceof Error && /timeout|timed out|Timeout/i.test(error.message);
}

// src/runner-service/auth.ts
function requireRunnerAuth(request, token) {
  if (!token) {
    return;
  }
  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${token}`) {
    throw new RunnerHttpError(401, "unauthorized", "Missing or invalid runner token.");
  }
}

// src/runner-core/limits.ts
var DEFAULT_MAX_TEXT_LENGTH = 4e3;
var DEFAULT_MAX_ELEMENTS = 50;
var DEFAULT_MAX_CONSOLE_ERRORS = 20;
var DEFAULT_MAX_NETWORK_ERRORS = 20;
var DEFAULT_REQUEST_BODY_LIMIT_BYTES = 1024 * 1024;
function toOptionalNumber(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function positiveInt(value, fallback) {
  const parsed = toOptionalNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// src/runner-service/body.ts
async function readJsonBody(request, limitBytes = DEFAULT_REQUEST_BODY_LIMIT_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limitBytes) {
      throw new RunnerHttpError(400, "request_too_large", "Request body is too large.");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new RunnerHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

// src/runner-core/redaction.ts
var REDACTED = "[REDACTED]";
var SENSITIVE_MARKERS = /(token|secret|password|passwd|api[_-]?key|session|cookie|authorization|localStorage|sessionStorage)/i;
function redactSensitiveText(value, explicitSecrets = []) {
  let redacted = value;
  for (const secret of explicitSecrets) {
    if (secret) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }
  return redacted.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`).replace(/\b(token|secret|password|passwd|api[_-]?key|session|cookie|authorization)\b\s*[:=]\s*["']?[^"',;\s}]+/gi, `$1=${REDACTED}`).replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED).slice(0, 4e3);
}
function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const [key] of url.searchParams) {
      if (SENSITIVE_MARKERS.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return redactSensitiveText(value);
  }
}
function safeErrorMessage(error, explicitSecrets = []) {
  if (error instanceof Error) {
    return redactSensitiveText(error.message || error.name, explicitSecrets);
  }
  return redactSensitiveText(String(error), explicitSecrets);
}

// src/runner-service/response.ts
function sendJson(response, statusCode, body) {
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json)
  });
  response.end(json);
}
function sendError(response, error, secrets = []) {
  if (error instanceof RunnerHttpError) {
    sendJson(response, error.statusCode, {
      error: {
        code: error.code,
        message: safeErrorMessage(error.message, secrets)
      }
    });
    return;
  }
  if (isTimeoutError(error)) {
    sendJson(response, 504, {
      error: {
        code: "timeout",
        message: safeErrorMessage(error, secrets)
      }
    });
    return;
  }
  sendJson(response, 500, {
    error: {
      code: "runner_failure",
      message: safeErrorMessage(error, secrets) || "Runner request failed."
    }
  });
}

// src/runner-service/routes.ts
var CAPABILITIES = [
  "browser.chromium",
  "playwright",
  "browser.session",
  "draft.validation",
  "regression.execution.v1",
  "artifact.download.v1"
];
async function handleRunnerRequest(request, response, context) {
  try {
    requireRunnerAuth(request, context.config.token);
    const url = new URL(request.url ?? "/", "http://runner.local");
    const pathname = trimTrailingSlash(url.pathname);
    if (request.method === "GET" && pathname === "/healthz") {
      sendJson(response, 200, health(context));
      return;
    }
    if (!pathname.startsWith("/v1")) {
      throw new RunnerHttpError(404, "not_found", "Runner endpoint was not found.");
    }
    const executionArtifactRoute = pathname.match(/^\/v1\/executions\/([^/]+)\/artifacts\/([^/]+)$/);
    if (request.method === "GET" && executionArtifactRoute) {
      const artifact = context.executions.open(
        decodeURIComponent(executionArtifactRoute[1] ?? ""),
        decodeURIComponent(executionArtifactRoute[2] ?? "")
      );
      if (!artifact) throw new RunnerHttpError(404, "artifact_not_found", "Runner artifact was not found.");
      response.statusCode = 200;
      response.setHeader("Content-Type", artifact.contentType);
      if (artifact.sizeBytes !== null) response.setHeader("Content-Length", artifact.sizeBytes);
      artifact.stream.on("error", () => response.destroy());
      artifact.stream.pipe(response);
      return;
    }
    const executionRoute = pathname.match(/^\/v1\/executions\/([^/]+)$/);
    if (request.method === "DELETE" && executionRoute) {
      await context.executions.cleanup(decodeURIComponent(executionRoute[1] ?? ""));
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && pathname === "/v1/sessions") {
      const body = await readJsonBody(request);
      validateCreateSession(body);
      sendJson(response, 200, await context.sessions.create(body));
      return;
    }
    if (request.method === "POST" && pathname === "/v1/execute-tests") {
      const body = await readJsonBody(request);
      validateExecuteTests(body);
      const executionId = (0, import_node_crypto2.randomUUID)();
      const artifactDirectory = resolveArtifactDirectory(
        context.config.artifactDir,
        executionId,
        body.artifactDirectory
      );
      const summary = await executeRunnerTests(body, { artifactDirectory });
      sendJson(response, 200, context.executions.register(executionId, artifactDirectory, summary));
      return;
    }
    const sessionRoute = matchSessionRoute(pathname);
    if (!sessionRoute) {
      throw new RunnerHttpError(404, "not_found", "Runner endpoint was not found.");
    }
    if (request.method === "DELETE" && sessionRoute.action === null) {
      sendJson(response, 200, await context.sessions.end(sessionRoute.sessionId));
      return;
    }
    if (request.method !== "POST" || sessionRoute.action === null) {
      throw new RunnerHttpError(404, "not_found", "Runner endpoint was not found.");
    }
    const session = context.sessions.get(sessionRoute.sessionId);
    const browserSession = session.browserSession;
    switch (sessionRoute.action) {
      case "prepare": {
        sendJson(response, 200, await context.sessions.prepare(sessionRoute.sessionId));
        return;
      }
      case "navigate": {
        const body = await readJsonBody(request);
        validateRequiredString(body.url, "url");
        sendJson(response, 200, await browserSession.navigate(body));
        return;
      }
      case "snapshot": {
        sendJson(
          response,
          200,
          await browserSession.snapshot(await readJsonBody(request))
        );
        return;
      }
      case "click": {
        const body = await readJsonBody(request);
        validateRequiredString(body.locator, "locator");
        sendJson(response, 200, await browserSession.click(body));
        return;
      }
      case "fill": {
        const body = await readJsonBody(request);
        validateRequiredString(body.locator, "locator");
        sendJson(response, 200, await browserSession.fill(body));
        return;
      }
      case "press": {
        const body = await readJsonBody(request);
        validateRequiredString(body.key, "key");
        sendJson(response, 200, await browserSession.press(body));
        return;
      }
      case "select": {
        const body = await readJsonBody(request);
        validateRequiredString(body.locator, "locator");
        sendJson(response, 200, await browserSession.select(body));
        return;
      }
      case "check": {
        const body = await readJsonBody(request);
        validateRequiredString(body.locator, "locator");
        sendJson(response, 200, await browserSession.check(body));
        return;
      }
      case "screenshot": {
        sendJson(
          response,
          200,
          await browserSession.screenshot(await readJsonBody(request))
        );
        return;
      }
      case "console": {
        sendJson(response, 200, browserSession.getConsoleEntries());
        return;
      }
      case "network": {
        sendJson(response, 200, browserSession.getNetworkEntries());
        return;
      }
      case "validate-draft": {
        const body = await readJsonBody(request);
        validateRequiredString(body.name, "name");
        validateRequiredString(body.source, "source");
        if (body.environment) {
          throw new RunnerHttpError(
            400,
            "draft_environment_not_allowed",
            "Draft validation uses the prepared session and does not accept an environment payload."
          );
        }
        sendJson(response, 200, await browserSession.validateDraft(body));
        return;
      }
      case "execute-tests": {
        const body = await readJsonBody(request);
        validateExecuteTests(body);
        const executionId = (0, import_node_crypto2.randomUUID)();
        const artifactDirectory = resolveArtifactDirectory(
          session.artifactDirectory,
          executionId,
          null
        );
        const controller = new AbortController();
        request.once("aborted", () => controller.abort());
        const summary = await browserSession.executeTests(body, artifactDirectory, controller.signal);
        sendJson(response, 200, context.executions.register(executionId, artifactDirectory, summary));
        return;
      }
    }
  } catch (error) {
    sendError(response, error, [context.config.token ?? ""]);
  }
}
function health(context) {
  const activeSessions = context.sessions.activeSessions;
  return {
    status: activeSessions < context.config.maxSessions ? "ok" : "degraded",
    runnerInstanceId: context.config.runnerInstanceId,
    version: context.config.version,
    capabilities: CAPABILITIES,
    activeSessions,
    maxSessions: context.config.maxSessions
  };
}
function matchSessionRoute(pathname) {
  const match = pathname.match(/^\/v1\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) {
    return null;
  }
  const action = match[2] ?? null;
  if (action !== null && ![
    "navigate",
    "snapshot",
    "click",
    "fill",
    "press",
    "select",
    "check",
    "screenshot",
    "console",
    "network",
    "prepare",
    "validate-draft",
    "execute-tests"
  ].includes(action)) {
    return null;
  }
  return {
    sessionId: decodeURIComponent(match[1] ?? ""),
    action
  };
}
function validateCreateSession(request) {
  if (request.baseUrl !== null && request.baseUrl !== void 0) {
    validateRequiredString(request.baseUrl, "baseUrl");
  }
}
function validateExecuteTests(request) {
  if (!Array.isArray(request.tests)) {
    throw new RunnerHttpError(400, "invalid_request", "tests must be an array.");
  }
  for (const test of request.tests) {
    validateRequiredString(test.testId, "testId");
    validateRequiredString(test.name, "name");
    validateRequiredString(test.runnerKind, "runnerKind");
    validateRequiredString(test.source, "source");
  }
}
function validateRequiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new RunnerHttpError(400, "invalid_request", `${field} is required.`);
  }
}
function trimTrailingSlash(value) {
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}

// src/runner-service/session-store.ts
var import_node_crypto3 = require("crypto");

// src/runner-core/browser-session.ts
var import_playwright = require("playwright");
var import_promises3 = require("fs/promises");
var import_node_os3 = require("os");
var import_node_path6 = require("path");
init_playwright_install();

// src/runner-core/browser-tools.ts
function resolveLocator(page, locator) {
  const trimmed = locator.trim();
  const role = trimmed.match(/^getByRole\((['"])([^'"]+)\1,\s*\{\s*name:\s*(['"])(.*?)\3\s*\}\)$/);
  if (role) {
    return page.getByRole(role[2], { name: unescapeLocatorText(role[4] ?? "") });
  }
  const label = trimmed.match(/^getByLabel\((['"])(.*?)\1\)$/);
  if (label) {
    return page.getByLabel(unescapeLocatorText(label[2] ?? ""));
  }
  const placeholder = trimmed.match(/^getByPlaceholder\((['"])(.*?)\1\)$/);
  if (placeholder) {
    return page.getByPlaceholder(unescapeLocatorText(placeholder[2] ?? ""));
  }
  const locatorCall2 = trimmed.match(/^locator\((['"])(.*?)\1\)$/);
  if (locatorCall2) {
    return page.locator(unescapeLocatorText(locatorCall2[2] ?? ""));
  }
  return page.locator(trimmed);
}
function unescapeLocatorText(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
}

// src/runner-core/browser-snapshot.ts
async function buildBrowserSnapshot(page, request, options) {
  const maxTextLength = positiveInt(request.maxTextLength, DEFAULT_MAX_TEXT_LENGTH);
  const maxElements = positiveInt(request.maxElements, DEFAULT_MAX_ELEMENTS);
  const raw = await page.evaluate(extractSnapshot, { maxElements });
  const visibleTextPreview = raw.visibleText.length > maxTextLength ? raw.visibleText.slice(0, maxTextLength) : raw.visibleText;
  const screenshot = request.includeScreenshot ? await captureSnapshotScreenshot(page, options.artifactDirectory) : null;
  return {
    url: page.url(),
    title: raw.title || null,
    visibleTextPreview,
    headings: raw.headings,
    buttons: raw.buttons,
    links: raw.links,
    inputs: raw.inputs,
    forms: raw.forms,
    candidateLocators: raw.candidateLocators,
    consoleErrors: options.consoleErrors.slice(-DEFAULT_MAX_CONSOLE_ERRORS),
    networkErrors: options.networkErrors.slice(-DEFAULT_MAX_NETWORK_ERRORS),
    screenshot,
    truncated: raw.visibleText.length > maxTextLength || raw.headings.length >= maxElements || raw.buttons.length >= maxElements || raw.links.length >= maxElements || raw.inputs.length >= maxElements
  };
}
async function captureSnapshotScreenshot(page, artifactDirectory) {
  try {
    const data = await page.screenshot({ fullPage: false, animations: "disabled" });
    return await writeArtifact(
      artifactDirectory,
      "screenshot",
      `snapshot-${Date.now()}.png`,
      "image/png",
      data
    );
  } catch {
    return null;
  }
}
function extractSnapshot(args) {
  const locatorCall2 = (kind, value, role) => {
    if (kind === "getByRole") {
      return `getByRole(${JSON.stringify(role ?? "button")}, { name: ${JSON.stringify(value)} })`;
    }
    if (kind === "getByLabel") {
      return `getByLabel(${JSON.stringify(value)})`;
    }
    if (kind === "getByPlaceholder") {
      return `getByPlaceholder(${JSON.stringify(value)})`;
    }
    return `locator(${JSON.stringify(value)})`;
  };
  const sensitive = (value) => Boolean(value && /(token|secret|password|passwd|api[_-]?key|session|cookie|authorization|localStorage|sessionStorage)/i.test(value));
  const isSensitiveField2 = (input) => [
    input.type,
    input.name,
    input.label,
    input.placeholder,
    input.selector
  ].some(sensitive);
  const cleanText = (value) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const attr = (element, name) => {
    const value = element.getAttribute(name)?.trim();
    return value || null;
  };
  const cssEscape = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const isVisible = (element) => {
    const html = element;
    const style = window.getComputedStyle(html);
    const rect = html.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const visibleElements = (selector) => Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const findLabel = (element) => {
    const aria = attr(element, "aria-label");
    if (aria) {
      return aria;
    }
    const id = attr(element, "id");
    if (id) {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
      const text = cleanText(label?.textContent);
      if (text) {
        return text;
      }
    }
    const wrapped = element.closest("label");
    return cleanText(wrapped?.textContent) || null;
  };
  const stableSelector = (element) => {
    const testId = attr(element, "data-testid") ?? attr(element, "data-test");
    if (testId) {
      return `[data-testid="${cssEscape(testId)}"]`;
    }
    const id = attr(element, "id");
    if (id && /^[A-Za-z][A-Za-z0-9_-]{1,80}$/.test(id)) {
      return `#${cssEscape(id)}`;
    }
    const name = attr(element, "name");
    if (name) {
      return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
    }
    return null;
  };
  const interactiveElement = (element, role, candidates) => {
    const text = cleanText(
      element.textContent || attr(element, "value") || attr(element, "aria-label") || attr(element, "title") || ""
    ) || null;
    const selector = stableSelector(element);
    const candidateLocator = text ? locatorCall2("getByRole", text, role) : selector ? locatorCall2("locator", selector) : null;
    if (candidateLocator) {
      candidates.push({
        kind: text ? "role" : "selector",
        value: candidateLocator,
        confidence: text ? "high" : "medium"
      });
    }
    return {
      text,
      role,
      selector,
      candidateLocator,
      disabled: element.disabled === true
    };
  };
  const inputElement = (element, candidates) => {
    const type = attr(element, "type") ?? element.tagName.toLowerCase();
    const name = attr(element, "name");
    const placeholder = attr(element, "placeholder");
    const label = findLabel(element);
    const selector = stableSelector(element);
    const candidateLocator = label ? locatorCall2("getByLabel", label) : placeholder ? locatorCall2("getByPlaceholder", placeholder) : name ? locatorCall2("locator", `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`) : selector ? locatorCall2("locator", selector) : null;
    if (candidateLocator) {
      candidates.push({
        kind: label ? "label" : placeholder ? "placeholder" : "selector",
        value: candidateLocator,
        confidence: label || placeholder ? "high" : "medium"
      });
    }
    return {
      label,
      placeholder,
      name,
      type,
      selector,
      candidateLocator,
      valueRedacted: isSensitiveField2({ type, name, label, placeholder, selector })
    };
  };
  const dedupeCandidates = (values) => {
    const seen = /* @__PURE__ */ new Set();
    return values.filter((value) => {
      if (seen.has(value.value)) {
        return false;
      }
      seen.add(value.value);
      return true;
    });
  };
  const maxElements = args.maxElements;
  const candidateLocators = [];
  const headings = visibleElements("h1,h2,h3,h4,h5,h6").slice(0, maxElements).map((element) => {
    const text = cleanText(element.textContent);
    const level = Number(element.tagName.slice(1));
    const candidateLocator = text ? locatorCall2("getByRole", text, "heading") : null;
    if (candidateLocator) {
      candidateLocators.push({ kind: "role", value: candidateLocator, confidence: "medium" });
    }
    return { text, level, candidateLocator };
  }).filter((element) => element.text);
  const buttons = visibleElements("button,[role='button'],input[type='button'],input[type='submit']").slice(0, maxElements).map((element) => interactiveElement(element, "button", candidateLocators));
  const links = visibleElements("a[href]").slice(0, maxElements).map((element) => interactiveElement(element, "link", candidateLocators));
  const inputs = visibleElements("input,textarea,select").slice(0, maxElements).map((element) => inputElement(element, candidateLocators));
  const forms = visibleElements("form").slice(0, Math.min(10, maxElements)).map((form) => {
    const formInputs = Array.from(form.querySelectorAll("input,textarea,select")).filter(isVisible).slice(0, maxElements).map((element) => inputElement(element, candidateLocators));
    const submitButtons = Array.from(form.querySelectorAll("button,input[type='submit']")).filter(isVisible).slice(0, maxElements).map((element) => interactiveElement(element, "button", candidateLocators));
    return {
      name: attr(form, "name"),
      action: attr(form, "action"),
      method: attr(form, "method"),
      inputs: formInputs,
      submitButtons
    };
  });
  return {
    title: document.title,
    visibleText: cleanText(document.body?.innerText ?? ""),
    headings,
    buttons,
    links,
    inputs,
    forms,
    candidateLocators: dedupeCandidates(candidateLocators).slice(0, maxElements)
  };
}

// src/runner-core/session-auth.ts
var USERNAME_SELECTORS = [
  'input[type="email"]:visible',
  'input[name="email"]:visible',
  'input[name="username"]:visible',
  'input[autocomplete="username"]:visible',
  'input[type="text"]:visible'
];
async function prepareRunnerSession(page, environment, timeoutMs) {
  if (!environment || environment.authMode === "none") {
    return ready(page);
  }
  if (environment.authMode === "custom_instructions") {
    if (requiresHumanOrSecret(environment.loginInstructions)) {
      return blocked(
        "Custom login instructions require a secret, MFA, or human action.",
        "unsupported_auth_flow",
        page
      );
    }
    return ready(page, "Custom login instructions are available to the authoring worker.");
  }
  if (environment.authMode !== "username_password" || !environment.username || !environment.password) {
    return blocked("Runner login credentials are unavailable.", "missing_credentials", page);
  }
  try {
    await page.goto(environment.loginUrl ?? environment.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });
    const username = await findUsernameInput(page, timeoutMs);
    const password = page.locator('input[type="password"]:visible').first();
    if (!username || !await password.isVisible({ timeout: Math.min(timeoutMs, 5e3) }).catch(() => false)) {
      return blocked("Runner could not find the configured login fields.", "login_fields_missing", page);
    }
    await username.fill(environment.username, { timeout: timeoutMs });
    await password.fill(environment.password, { timeout: timeoutMs });
    await password.press("Enter", { timeout: timeoutMs });
    await verify(page, environment, timeoutMs);
    return ready(page, "Runner login completed.");
  } catch (error) {
    return blocked("Runner login failed.", isTimeout(error) ? "auth_timeout" : "auth_failed", page);
  }
}
async function findUsernameInput(page, timeoutMs) {
  for (const selector of USERNAME_SELECTORS) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: Math.min(timeoutMs, 2e3) }).catch(() => false)) {
      return locator;
    }
  }
  return null;
}
async function verify(page, environment, timeoutMs) {
  const verification = environment.postLoginVerification;
  if (!verification) {
    return;
  }
  if (verification.type === "url_contains") {
    await page.waitForURL(`**${verification.value}**`, { timeout: timeoutMs });
    return;
  }
  if (verification.type === "selector_exists") {
    await page.locator(verification.value).first().waitFor({ state: "visible", timeout: timeoutMs });
    return;
  }
  await page.getByText(verification.value, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs });
}
function ready(page, summary = "Runner session is ready.") {
  return { status: "ready", summary, errorCode: null, url: page.url() };
}
function blocked(summary, errorCode, page) {
  return { status: "blocked", summary, errorCode, url: page.url() };
}
function isTimeout(error) {
  return error instanceof Error && (error.name === "TimeoutError" || /timeout/i.test(error.message));
}
function requiresHumanOrSecret(instructions) {
  return /\b(password|secret|token|api[ _-]?key|mfa|2fa|otp|one[- ]time|captcha|human|manually)\b/i.test(instructions ?? "");
}

// src/runner-core/browser-session.ts
var MAX_RING_ENTRIES = 100;
var BrowserSession = class _BrowserSession {
  constructor(options) {
    this.options = options;
  }
  options;
  browser = null;
  context = null;
  page = null;
  consoleEntries = [];
  networkEntries = [];
  static async create(options) {
    await ensurePlaywrightBrowserInstalled();
    const session = new _BrowserSession(options);
    session.browser = await import_playwright.chromium.launch({ headless: options.headless });
    session.context = await session.browser.newContext({
      baseURL: options.baseUrl ?? void 0
    });
    await session.configureOriginGuard();
    session.page = await session.context.newPage();
    session.attachPageEvents(session.page);
    return session;
  }
  async navigate(request) {
    const page = this.requirePage();
    await page.goto(request.url, {
      waitUntil: normalizeWaitUntil(request.waitUntil),
      timeout: timeout(request.timeoutMs, this.options.timeoutMs)
    });
    return {
      url: page.url(),
      title: await page.title().catch(() => null),
      snapshot: await this.snapshot({
        includeScreenshot: false,
        maxTextLength: null,
        maxElements: null
      })
    };
  }
  async snapshot(request) {
    const snapshot = await buildBrowserSnapshot(this.requirePage(), request, {
      artifactDirectory: this.options.artifactDirectory,
      consoleErrors: this.getConsoleEntries().filter(
        (entry) => ["error", "pageerror"].includes(entry.level)
      ),
      networkErrors: this.getNetworkEntries()
    });
    return redactSnapshot(snapshot, this.explicitSecrets());
  }
  async click(request) {
    await resolveLocator(this.requirePage(), request.locator).click({
      timeout: timeout(request.timeoutMs, this.options.timeoutMs)
    });
    return this.snapshot(defaultSnapshotRequest());
  }
  async fill(request) {
    await resolveLocator(this.requirePage(), request.locator).fill(request.value, {
      timeout: timeout(request.timeoutMs, this.options.timeoutMs)
    });
    return this.snapshot(defaultSnapshotRequest());
  }
  async press(request) {
    const page = this.requirePage();
    if (request.locator) {
      await resolveLocator(page, request.locator).press(request.key, {
        timeout: timeout(request.timeoutMs, this.options.timeoutMs)
      });
    } else {
      await page.keyboard.press(request.key);
    }
    return this.snapshot(defaultSnapshotRequest());
  }
  async select(request) {
    await resolveLocator(this.requirePage(), request.locator).selectOption(request.value, {
      timeout: timeout(request.timeoutMs, this.options.timeoutMs)
    });
    return this.snapshot(defaultSnapshotRequest());
  }
  async check(request) {
    const locator = resolveLocator(this.requirePage(), request.locator);
    if (request.checked) {
      await locator.check({ timeout: timeout(request.timeoutMs, this.options.timeoutMs) });
    } else {
      await locator.uncheck({ timeout: timeout(request.timeoutMs, this.options.timeoutMs) });
    }
    return this.snapshot(defaultSnapshotRequest());
  }
  async screenshot(request) {
    const data = await this.requirePage().screenshot({
      fullPage: request.fullPage,
      animations: "disabled",
      mask: [this.requirePage().locator(SENSITIVE_SCREENSHOT_SELECTOR)]
    });
    return await writeArtifact(
      this.options.artifactDirectory,
      "screenshot",
      request.fileName ?? `screenshot-${Date.now()}.png`,
      "image/png",
      data
    );
  }
  getConsoleEntries() {
    return [...this.consoleEntries];
  }
  getNetworkEntries() {
    return [...this.networkEntries];
  }
  async prepare() {
    return await prepareRunnerSession(
      this.requirePage(),
      this.options.environment,
      this.options.timeoutMs
    );
  }
  async validateDraft(request) {
    const context = this.context;
    if (!context) {
      throw new Error("Browser session is closed.");
    }
    const stateDirectory = await (0, import_promises3.mkdtemp)((0, import_node_path6.join)((0, import_node_os3.tmpdir)(), "testmutant-session-state-"));
    const storageStatePath = (0, import_node_path6.join)(stateDirectory, "storage-state.json");
    try {
      await context.storageState({ path: storageStatePath });
      return await validateDraftPlaywrightTest(request, {
        artifactDirectory: request.artifactDirectory ?? this.options.artifactDirectory,
        storageStatePath,
        explicitSecrets: this.explicitSecrets()
      });
    } finally {
      await (0, import_promises3.rm)(stateDirectory, { recursive: true, force: true });
    }
  }
  async executeTests(request, artifactDirectory, signal) {
    const context = this.context;
    if (!context) throw new Error("Browser session is closed.");
    const stateDirectory = await (0, import_promises3.mkdtemp)((0, import_node_path6.join)((0, import_node_os3.tmpdir)(), "testmutant-session-state-"));
    const storageStatePath = (0, import_node_path6.join)(stateDirectory, "storage-state.json");
    try {
      await context.storageState({ path: storageStatePath });
      return await executeRunnerTests({ ...request, environment: null }, {
        artifactDirectory,
        storageStatePath,
        explicitSecrets: this.explicitSecrets(),
        signal,
        traceMode: "retain-on-failure",
        videoMode: "off"
      });
    } finally {
      await (0, import_promises3.rm)(stateDirectory, { recursive: true, force: true });
    }
  }
  async close() {
    await this.context?.close().catch(() => {
    });
    await this.browser?.close().catch(() => {
    });
    this.context = null;
    this.browser = null;
    this.page = null;
  }
  requirePage() {
    if (!this.page) {
      throw new Error("Browser session is closed.");
    }
    return this.page;
  }
  attachPageEvents(page) {
    page.on("console", (message) => {
      pushRing(this.consoleEntries, {
        level: message.type(),
        message: redactSensitiveText(message.text(), this.explicitSecrets()),
        timestampUtc: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    page.on("pageerror", (error) => {
      pushRing(this.consoleEntries, {
        level: "pageerror",
        message: safeErrorMessage(error, this.explicitSecrets()),
        timestampUtc: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    page.on("requestfailed", (request) => {
      pushRing(this.networkEntries, {
        url: redactSensitiveText(redactUrl(request.url()), this.explicitSecrets()),
        method: request.method(),
        status: null,
        failureText: redactSensitiveText(request.failure()?.errorText ?? "request failed", this.explicitSecrets()),
        timestampUtc: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    page.on("response", (response) => {
      if (response.status() < 400) {
        return;
      }
      pushRing(this.networkEntries, {
        url: redactSensitiveText(redactUrl(response.url()), this.explicitSecrets()),
        method: response.request().method(),
        status: response.status(),
        failureText: null,
        timestampUtc: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
  }
  explicitSecrets() {
    return [
      this.options.environment?.username ?? "",
      this.options.environment?.password ?? ""
    ].filter(Boolean);
  }
  async configureOriginGuard() {
    const context = this.context;
    if (!context) {
      return;
    }
    const allowedOrigins = [this.options.baseUrl, this.options.environment?.loginUrl].flatMap((value) => {
      try {
        return value ? [new URL(value).origin] : [];
      } catch {
        return [];
      }
    });
    if (allowedOrigins.length === 0) {
      return;
    }
    await context.route("**/*", async (route) => {
      try {
        const origin = new URL(route.request().url()).origin;
        if (allowedOrigins.includes(origin)) {
          await route.continue();
          return;
        }
      } catch {
      }
      await route.abort("blockedbyclient");
    });
  }
};
var SENSITIVE_SCREENSHOT_SELECTOR = [
  "input[type='password']",
  "input[name*='password' i]",
  "input[name*='token' i]",
  "input[name*='secret' i]",
  "textarea[name*='secret' i]"
].join(", ");
function redactSnapshot(snapshot, secrets) {
  const redact = (value) => value === null ? null : redactSensitiveText(value, secrets);
  return {
    ...snapshot,
    url: redactSensitiveText(snapshot.url, secrets),
    title: redact(snapshot.title),
    visibleTextPreview: redact(snapshot.visibleTextPreview),
    headings: snapshot.headings.map((item) => ({ ...item, text: redactSensitiveText(item.text, secrets) })),
    buttons: snapshot.buttons.map((item) => ({ ...item, text: redact(item.text) })),
    links: snapshot.links.map((item) => ({ ...item, text: redact(item.text) })),
    consoleErrors: snapshot.consoleErrors.map((item) => ({ ...item, message: redactSensitiveText(item.message, secrets) })),
    networkErrors: snapshot.networkErrors.map((item) => ({
      ...item,
      url: redactSensitiveText(item.url, secrets),
      failureText: redact(item.failureText)
    }))
  };
}
function pushRing(entries, entry) {
  entries.push(entry);
  if (entries.length > MAX_RING_ENTRIES) {
    entries.splice(0, entries.length - MAX_RING_ENTRIES);
  }
}
function timeout(value, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function normalizeWaitUntil(value) {
  if (value === "load" || value === "networkidle" || value === "commit") {
    return value;
  }
  return "domcontentloaded";
}
function defaultSnapshotRequest() {
  return {
    includeScreenshot: false,
    maxTextLength: null,
    maxElements: null
  };
}

// src/runner-service/session-store.ts
var SessionStore = class {
  constructor(config) {
    this.config = config;
  }
  config;
  sessions = /* @__PURE__ */ new Map();
  get activeSessions() {
    this.cleanupExpired().catch(() => {
    });
    return this.sessions.size;
  }
  async create(request) {
    await this.cleanupExpired();
    if (this.sessions.size >= this.config.maxSessions) {
      throw new RunnerHttpError(
        429,
        "max_sessions_exceeded",
        "Runner has no available session capacity."
      );
    }
    const sessionId = (0, import_node_crypto3.randomUUID)();
    const createdAtUtc = (/* @__PURE__ */ new Date()).toISOString();
    const expiresAtUtc = new Date(Date.now() + this.config.sessionTimeoutMs).toISOString();
    const artifactDirectory = resolveArtifactDirectory(
      this.config.artifactDir,
      sessionId,
      request.artifactDirectory
    );
    const browserSession = await BrowserSession.create({
      sessionId,
      baseUrl: request.baseUrl,
      environment: request.environment ?? null,
      artifactDirectory,
      headless: request.headless ?? this.config.headless,
      timeoutMs: toNumber2(request.timeoutMs) ?? this.config.sessionTimeoutMs
    });
    this.sessions.set(sessionId, {
      sessionId,
      runnerInstanceId: this.config.runnerInstanceId,
      createdAtUtc,
      expiresAtUtc,
      baseUrl: request.baseUrl,
      artifactDirectory,
      metadata: request.metadata,
      browserSession
    });
    return {
      sessionId,
      runnerInstanceId: this.config.runnerInstanceId,
      startedAtUtc: createdAtUtc,
      expiresAtUtc,
      browserName: "chromium",
      runnerVersion: this.config.version
    };
  }
  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new RunnerHttpError(404, "session_not_found", "Runner session was not found.");
    }
    if (Date.parse(session.expiresAtUtc) <= Date.now()) {
      void this.end(sessionId);
      throw new RunnerHttpError(404, "session_expired", "Runner session has expired.");
    }
    return session;
  }
  async prepare(sessionId) {
    return await this.get(sessionId).browserSession.prepare();
  }
  async end(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      await session.browserSession.close();
    }
    return {
      sessionId,
      endedAtUtc: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.end(sessionId)));
  }
  async cleanupExpired() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (Date.parse(session.expiresAtUtc) <= now) {
        await this.end(sessionId);
      }
    }
  }
};
function toNumber2(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// src/runner-service/execution-artifact-store.ts
var import_node_fs = require("fs");
var import_promises4 = require("fs/promises");
var import_node_path7 = require("path");
var import_node_crypto4 = require("crypto");
var ExecutionArtifactStore = class {
  executions = /* @__PURE__ */ new Map();
  register(executionId, directory, summary) {
    const artifacts = /* @__PURE__ */ new Map();
    const tests = summary.tests.map((test) => ({
      ...test,
      artifacts: test.artifacts.map((artifact) => this.registerArtifact(executionId, directory, artifact, artifacts))
    }));
    this.executions.set(executionId, { directory: (0, import_node_path7.resolve)(directory), artifacts });
    return { ...summary, tests, executionId, suiteStatus: "completed" };
  }
  open(executionId, artifactId) {
    const artifact = this.executions.get(executionId)?.artifacts.get(artifactId);
    return artifact ? { ...artifact, stream: (0, import_node_fs.createReadStream)(artifact.path) } : null;
  }
  async cleanup(executionId) {
    const execution = this.executions.get(executionId);
    this.executions.delete(executionId);
    if (execution) await (0, import_promises4.rm)(execution.directory, { recursive: true, force: true });
  }
  async closeAll() {
    await Promise.all([...this.executions.keys()].map((id) => this.cleanup(id)));
  }
  registerArtifact(executionId, directory, artifact, artifacts) {
    if (!artifact.path) return { ...artifact, path: null, artifactId: null, executionId };
    const root = (0, import_node_path7.resolve)(directory);
    const path = (0, import_node_path7.resolve)(artifact.path);
    if (path !== root && !path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) {
      return { ...artifact, path: null, artifactId: null, executionId };
    }
    const artifactId = (0, import_node_crypto4.randomUUID)();
    artifacts.set(artifactId, {
      path,
      contentType: artifact.contentType ?? "application/octet-stream",
      sizeBytes: typeof artifact.sizeBytes === "number" ? artifact.sizeBytes : null
    });
    return { ...artifact, path: null, artifactId, executionId };
  }
};

// src/runner-service/server.ts
async function startRunnerService(config) {
  const sessions = new SessionStore(config);
  const executions = new ExecutionArtifactStore();
  const server = (0, import_node_http.createServer)((request, response) => {
    void handleRunnerRequest(request, response, { config, sessions, executions }).catch((error) => {
      console.error(`runner-service request failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  await new Promise((resolve3, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve3();
    });
  });
  return {
    server,
    sessions,
    executions,
    async stop() {
      await new Promise((resolve3) => {
        server.close(() => resolve3());
      });
      await sessions.closeAll();
      await executions.closeAll();
    }
  };
}

// src/commands/runner-service.ts
async function runRunnerServiceCommand(options, version) {
  const config = resolveRunnerServiceConfig(options, version);
  const handle = await startRunnerService(config);
  console.error(
    `TestMutant runner service listening on ${config.host}:${config.port} (${config.runnerInstanceId})`
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.error("TestMutant runner service shutting down.");
    await handle.stop();
  };
  process.once("SIGINT", () => {
    void stop().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().then(() => process.exit(0));
  });
  await new Promise(() => {
  });
}

// src/api-client.ts
init_config();
var TestMutantApiClient = class {
  constructor(options) {
    this.options = options;
  }
  options;
  async ping() {
    return this.postJson("/api/cli/v1/ping", {
      repositoryProvider: null,
      repositoryFullName: null
    });
  }
  async createRun(request) {
    return this.postJson(
      "/api/cli/v1/runs",
      request,
      201
    );
  }
  async completeRun(runId, request) {
    return this.postJson(
      `/api/cli/v1/runs/${encodeURIComponent(runId)}/complete`,
      request
    );
  }
  async uploadScreenshot(runId, implementationId, screenshot) {
    const path = `/api/cli/v1/runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(implementationId)}/screenshot`;
    const formData = new FormData();
    const bytes = screenshot.buffer.slice(
      screenshot.byteOffset,
      screenshot.byteOffset + screenshot.byteLength
    );
    formData.append(
      "file",
      new Blob([bytes], { type: "image/png" }),
      "screenshot.png"
    );
    const controller = new AbortController();
    const timeout2 = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.options.apiUrl), {
        method: "POST",
        body: formData,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "user-agent": this.options.userAgent
        }
      });
      if (response.status !== 200) {
        console.error(`Screenshot upload failed with HTTP ${response.status}`);
      }
    } catch {
    } finally {
      clearTimeout(timeout2);
    }
  }
  async postJson(path, body, expectedStatus = 200) {
    const response = await this.request(path, body);
    if (response.status === 401) {
      throw new CliError("Unauthorized. Check your TestMutant API key.", 3);
    }
    if (response.status !== expectedStatus) {
      const detail = await readErrorDetail(response);
      throw new CliError(
        `TestMutant API request failed with HTTP ${response.status}.${detail}`
      );
    }
    try {
      return await response.json();
    } catch {
      throw new CliError("TestMutant API returned invalid JSON.");
    }
  }
  async request(path, body) {
    const controller = new AbortController();
    const timeout2 = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await fetch(new URL(path, this.options.apiUrl), {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
          "user-agent": this.options.userAgent
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CliError(
          `TestMutant API request timed out after ${this.options.timeoutMs} ms.`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(`Could not reach TestMutant API. ${message}`);
    } finally {
      clearTimeout(timeout2);
    }
  }
};
async function readErrorDetail(response) {
  const body = await response.text();
  if (!body) {
    return "";
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      const problem = JSON.parse(body);
      const parts = [
        typeof problem.title === "string" ? problem.title : null,
        typeof problem.detail === "string" ? problem.detail : null,
        formatValidationErrors(problem.errors)
      ].filter((part) => Boolean(part));
      if (parts.length > 0) {
        return ` ${truncate2(parts.join(" "), 500)}`;
      }
    } catch {
      return ` ${truncate2(body, 500)}`;
    }
  }
  return ` ${truncate2(body, 500)}`;
}
function formatValidationErrors(errors) {
  if (!errors || typeof errors !== "object") {
    return null;
  }
  const messages = [];
  for (const [field, value] of Object.entries(errors)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          messages.push(`${field}: ${item}`);
        }
      }
    }
  }
  return messages.length > 0 ? messages.join(" ") : null;
}
function truncate2(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
var HostedRunnerApiClient = class {
  constructor(options) {
    this.options = options;
  }
  options;
  async heartbeat(projectId, runId) {
    return this.postJson(
      `/api/cli/v1/hosted-runner/projects/${enc(projectId)}/runs/${enc(runId)}/heartbeat`
    );
  }
  async reportTestResult(projectId, runId, implementationId, request) {
    return this.postJson(
      `/api/cli/v1/hosted-runner/projects/${enc(projectId)}/runs/${enc(runId)}/results/${enc(implementationId)}`,
      request
    );
  }
  async completeRunResults(projectId, runId, request) {
    return this.postJson(
      `/api/cli/v1/hosted-runner/projects/${enc(projectId)}/runs/${enc(runId)}/results/complete`,
      request
    );
  }
  async uploadArtifact(projectId, runId, request) {
    return this.postJson(
      `/api/cli/v1/hosted-runner/projects/${enc(projectId)}/runs/${enc(runId)}/artifacts`,
      request,
      201
    );
  }
  async postJson(path, body, expectedStatus = 200) {
    const controller = new AbortController();
    const timeout2 = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.options.apiUrl), {
        method: "POST",
        body: body !== void 0 ? JSON.stringify(body) : void 0,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...body !== void 0 ? { "content-type": "application/json" } : {},
          authorization: `Bearer ${this.options.sessionToken}`
        }
      });
      if (response.status === 401) {
        throw new CliError("Hosted runner session token rejected. The token may have expired or been revoked.", 3);
      }
      if (response.status !== expectedStatus) {
        const detail = await readErrorDetail(response);
        throw new CliError(
          `Hosted runner API request failed with HTTP ${response.status}.${detail}`
        );
      }
      try {
        return await response.json();
      } catch {
        throw new CliError("Hosted runner API returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new CliError(
          `Hosted runner API request timed out after ${this.options.timeoutMs} ms.`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(`Could not reach hosted runner API. ${message}`);
    } finally {
      clearTimeout(timeout2);
    }
  }
};
function enc(value) {
  return encodeURIComponent(value);
}

// src/ci-metadata.ts
var import_node_child_process3 = require("child_process");
var import_node_fs2 = require("fs");
init_config();
function buildCreateRunRequest(options = {}) {
  const env = process.env;
  const gitRepository = getGitRepositoryMetadata();
  const repositoryProvider = normalize(options.repositoryProvider) ?? normalize(env.TESTMUTANT_REPOSITORY_PROVIDER) ?? detectRepositoryProvider(env) ?? gitRepository.provider;
  const repositoryFullName = normalize(options.repositoryFullName) ?? normalize(env.TESTMUTANT_REPOSITORY_FULL_NAME) ?? detectRepositoryFullName(env) ?? gitRepository.fullName;
  if (!repositoryFullName) {
    throw new CliError(
      "Could not determine repository full name from CI environment or git remote origin.",
      2
    );
  }
  const testSpecId = normalize(options.testSpecId);
  return {
    runKind: normalize(options.runKind) ?? "Advisory",
    repositoryProvider: repositoryProvider ?? "GitHub",
    repositoryFullName,
    baseUrl: normalizeUrl(options.baseUrl) ?? detectBaseUrl(env),
    environmentName: normalize(options.environmentName) ?? detectEnvironmentName(env),
    branch: detectBranch(env) ?? git(["rev-parse", "--abbrev-ref", "HEAD"]),
    commitSha: detectCommitSha(env) ?? git(["rev-parse", "HEAD"]),
    pullRequestNumber: detectPullRequestNumber(env),
    ciProvider: detectCiProvider(env),
    ciRunId: detectCiRunId(env),
    ...testSpecId ? { testSpecId } : {}
  };
}
function detectRepositoryProvider(env) {
  if (env.GITHUB_ACTIONS || env.GITHUB_REPOSITORY) {
    return "GitHub";
  }
  if (env.GITLAB_CI || env.CI_PROJECT_PATH) {
    return "GitLab";
  }
  if (env.BITBUCKET_BUILD_NUMBER || env.BITBUCKET_REPO_FULL_NAME) {
    return "Bitbucket";
  }
  if (env.TF_BUILD || env.BUILD_REPOSITORY_URI) {
    return "AzureDevOps";
  }
  return null;
}
function detectRepositoryFullName(env) {
  if (env.GITHUB_REPOSITORY) {
    return normalize(env.GITHUB_REPOSITORY);
  }
  if (env.GITLAB_CI && env.CI_PROJECT_PATH) {
    return normalize(env.CI_PROJECT_PATH);
  }
  if (env.BITBUCKET_REPO_FULL_NAME) {
    return normalize(env.BITBUCKET_REPO_FULL_NAME);
  }
  if (env.CIRCLE_PROJECT_USERNAME && env.CIRCLE_PROJECT_REPONAME) {
    return `${env.CIRCLE_PROJECT_USERNAME}/${env.CIRCLE_PROJECT_REPONAME}`;
  }
  if (env.BUILD_REPOSITORY_NAME) {
    return normalize(env.BUILD_REPOSITORY_NAME);
  }
  return null;
}
function detectBranch(env) {
  return normalize(env.GITHUB_HEAD_REF) ?? normalize(env.GITHUB_REF_NAME) ?? branchFromGitRef(env.GITHUB_REF) ?? normalize(env.CI_COMMIT_REF_NAME) ?? normalize(env.BITBUCKET_BRANCH) ?? normalize(env.CIRCLE_BRANCH) ?? normalize(env.BUILDKITE_BRANCH) ?? normalize(env.BUILD_SOURCEBRANCHNAME) ?? branchFromGitRef(env.BUILD_SOURCEBRANCH);
}
function detectCommitSha(env) {
  return normalize(env.GITHUB_SHA) ?? normalize(env.CI_COMMIT_SHA) ?? normalize(env.BITBUCKET_COMMIT) ?? normalize(env.CIRCLE_SHA1) ?? normalize(env.BUILDKITE_COMMIT) ?? normalize(env.BUILD_SOURCEVERSION);
}
function detectPullRequestNumber(env) {
  return numberFromValue(env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)?.[1]) ?? githubEventPullRequestNumber(env) ?? numberFromValue(env.CI_MERGE_REQUEST_IID) ?? numberFromValue(env.BITBUCKET_PR_ID) ?? numberFromValue(env.CIRCLE_PULL_REQUEST?.split("/").pop()) ?? numberFromValue(env.BUILDKITE_PULL_REQUEST) ?? numberFromValue(env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER);
}
function detectCiProvider(env) {
  if (env.GITHUB_ACTIONS) {
    return "GitHubActions";
  }
  if (env.GITLAB_CI) {
    return "GitLabCI";
  }
  if (env.BITBUCKET_BUILD_NUMBER) {
    return "BitbucketPipelines";
  }
  if (env.CIRCLECI) {
    return "CircleCI";
  }
  if (env.BUILDKITE) {
    return "Buildkite";
  }
  if (env.TF_BUILD) {
    return "AzurePipelines";
  }
  if (env.JENKINS_URL) {
    return "Jenkins";
  }
  return env.CI ? "CI" : null;
}
function detectCiRunId(env) {
  return normalize(env.GITHUB_RUN_ID) ?? normalize(env.CI_PIPELINE_ID) ?? normalize(env.BITBUCKET_BUILD_NUMBER) ?? normalize(env.CIRCLE_WORKFLOW_ID) ?? normalize(env.CIRCLE_BUILD_NUM) ?? normalize(env.BUILDKITE_BUILD_ID) ?? normalize(env.BUILD_BUILDID) ?? normalize(env.BUILD_TAG) ?? normalize(env.BUILD_NUMBER);
}
function detectBaseUrl(env) {
  return normalizeUrl(env.TESTMUTANT_BASE_URL) ?? normalizeUrl(env.DEPLOY_URL) ?? normalizeUrl(env.URL) ?? normalizeUrl(env.VERCEL_BRANCH_URL) ?? normalizeUrl(env.VERCEL_URL) ?? normalizeUrl(env.CF_PAGES_URL) ?? normalizeUrl(env.RENDER_EXTERNAL_URL);
}
function detectEnvironmentName(env) {
  return normalize(env.TESTMUTANT_ENVIRONMENT) ?? normalize(env.CI_ENVIRONMENT_NAME) ?? normalize(env.VERCEL_ENV) ?? normalize(env.NETLIFY_CONTEXT) ?? normalize(env.CF_PAGES_BRANCH);
}
function githubEventPullRequestNumber(env) {
  const eventPath = normalize(env.GITHUB_EVENT_PATH);
  if (!eventPath || !(0, import_node_fs2.existsSync)(eventPath)) {
    return null;
  }
  try {
    const event = JSON.parse((0, import_node_fs2.readFileSync)(eventPath, "utf8"));
    return numberFromValue(event.pull_request?.number) ?? numberFromValue(event.number);
  } catch {
    return null;
  }
}
function getGitRepositoryMetadata() {
  const remote = git(["remote", "get-url", "origin"]);
  return remote ? parseGitRemoteUrl(remote) : { provider: null, fullName: null };
}
function parseGitRemoteUrl(remoteUrl) {
  const remote = remoteUrl.trim();
  const url = parseRemoteAsUrl(remote);
  const host = url?.host ?? parseScpRemoteHost(remote);
  const path = url?.pathname ?? parseScpRemotePath(remote);
  const fullName = path?.replace(/^\/+/, "").replace(/\.git$/i, "").replace(/^v\d+\//i, "");
  return {
    provider: host ? providerFromHost(host) : null,
    fullName: normalize(fullName)
  };
}
function parseRemoteAsUrl(remote) {
  try {
    return new URL(remote.replace(/^git\+/, ""));
  } catch {
    return null;
  }
}
function parseScpRemoteHost(remote) {
  return remote.match(/^(?:[^@]+@)?([^:]+):(.+)$/)?.[1] ?? null;
}
function parseScpRemotePath(remote) {
  return remote.match(/^(?:[^@]+@)?([^:]+):(.+)$/)?.[2] ?? null;
}
function providerFromHost(host) {
  const normalized = host.toLowerCase();
  if (normalized.includes("github")) {
    return "GitHub";
  }
  if (normalized.includes("gitlab")) {
    return "GitLab";
  }
  if (normalized.includes("bitbucket")) {
    return "Bitbucket";
  }
  if (normalized.includes("dev.azure") || normalized.includes("visualstudio")) {
    return "AzureDevOps";
  }
  return null;
}
function branchFromGitRef(value) {
  const ref = normalize(value);
  if (!ref) {
    return null;
  }
  return ref.match(/^refs\/heads\/(.+)$/)?.[1] ?? ref.match(/^refs\/tags\/(.+)$/)?.[1] ?? null;
}
function normalizeUrl(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return null;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  return `https://${normalized}`;
}
function numberFromValue(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  if (value.toLowerCase() === "false") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function normalize(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
function git(args) {
  try {
    const safeDirectory = process.cwd().replace(/\\/g, "/");
    return normalize(
      (0, import_node_child_process3.execFileSync)("git", ["-c", `safe.directory=${safeDirectory}`, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      })
    );
  } catch {
    return null;
  }
}

// src/cli/run-ci.ts
init_config();
init_playwright_runner();
async function runCi(options) {
  applyOptionEnvironmentOverrides(options);
  const config = resolveConfig({
    apiKey: options.apiKey,
    apiUrl: options.apiUrl,
    timeout: options.timeout
  });
  const client = new TestMutantApiClient({
    ...config,
    userAgent: options.userAgent
  });
  const createRunRequest = buildCreateRunRequest({
    runKind: options.runKind,
    repositoryProvider: options.provider,
    repositoryFullName: options.repository,
    baseUrl: options.baseUrl,
    environmentName: options.environmentName,
    testSpecId: options.testSpecId
  });
  const created = await client.createRun(createRunRequest);
  const runImplementations = created.implementations ?? [];
  const shouldGenerate = isGenerationKind(createRunRequest.runKind);
  if (shouldGenerate) {
    const agentGenerator = options.agentGenerator ?? await getDefaultAgentGenerator();
    const generationResult = await executeAgentGenerationForApiCompletion(
      agentGenerator,
      {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        userAgent: options.userAgent,
        runId: created.runId,
        baseUrl: createRunRequest.baseUrl
      }
    );
    if (!generationResult.ok) {
      await client.completeRun(created.runId, {
        status: "Failed",
        summary: `Test generation failed: ${generationResult.errorMessage}`,
        errorMessage: generationResult.errorMessage
      }).catch(() => {
      });
      if (isExecutionKind(createRunRequest.runKind)) {
        throw new CliError(
          `TestMutant test generation failed: ${generationResult.errorMessage}`,
          1
        );
      }
      return {
        runId: created.runId,
        status: "Failed",
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        tests: [],
        baseUrl: createRunRequest.baseUrl ?? null
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
      baseUrl: validationSummary?.baseUrl ?? createRunRequest.baseUrl ?? null
    };
  }
  const testExecutor = options.testExecutor ?? runPlaywrightTests;
  const testSummary = await executeTestsForApiCompletion(
    testExecutor,
    runImplementations,
    createRunRequest.baseUrl
  );
  const passed = testSummary.failed === 0;
  const completed = await client.completeRun(created.runId, {
    status: passed ? "Passed" : "Failed",
    summary: testSummary.total === 0 ? "CI metadata captured. No implementations were returned for this run." : `Executed ${testSummary.total} Playwright test${testSummary.total === 1 ? "" : "s"}: ${testSummary.passed} passed, ${testSummary.failed} failed.`,
    errorMessage: passed ? null : `${testSummary.failed} Playwright test failed.`,
    results: testSummary.tests.map((t) => ({
      implementationId: t.implementationId,
      status: t.status === "Passed" ? 0 : 1,
      durationMs: t.durationMs,
      errorMessage: t.errorMessage,
      stackTrace: null
    }))
  });
  for (const test of testSummary.tests) {
    if (test.screenshotBuffer) {
      await client.uploadScreenshot(created.runId, test.implementationId, test.screenshotBuffer).catch(() => {
      });
    }
  }
  if (!passed && isExecutionKind(createRunRequest.runKind)) {
    throw new CliError(
      `TestMutant run failed: ${testSummary.failed} of ${testSummary.total} Playwright tests failed.`,
      1
    );
  }
  return {
    runId: completed.runId,
    status: passed ? "Passed" : "Failed",
    totalTests: testSummary.total,
    passedTests: testSummary.passed,
    failedTests: testSummary.failed,
    tests: testSummary.tests,
    baseUrl: testSummary.baseUrl
  };
}
function applyOptionEnvironmentOverrides(options) {
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
function isGenerationKind(runKind) {
  return runKind?.trim().toLowerCase() === "generation";
}
async function getDefaultAgentGenerator() {
  const module2 = await Promise.resolve().then(() => (init_agent_runner(), agent_runner_exports));
  return module2.runAgentGeneration;
}
function isExecutionKind(runKind) {
  return runKind?.trim().toLowerCase() === "execution";
}
async function executeTestsForApiCompletion(testExecutor, implementations, baseUrl) {
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
        status: "Failed",
        errorMessage: message,
        durationMs: null,
        screenshotBuffer: null,
        traceBuffer: null,
        videoBuffer: null
      }))
    };
  }
}
async function executeAgentGenerationForApiCompletion(agentGenerator, options) {
  try {
    return {
      ok: true,
      result: await agentGenerator(options)
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

// src/hosted-runner.ts
init_agent_runner();
init_playwright_runner();
var ResultStatus = {
  Passed: 0,
  Failed: 1,
  Skipped: 2
};
var RunStatus = {
  Created: 0,
  Running: 1,
  Completed: 2,
  Failed: 3,
  Cancelled: 4,
  TimedOut: 5
};
var RunKind = {
  Generation: 2
};
var ArtifactKind = {
  Screenshot: 1,
  Trace: 2,
  Video: 3,
  Log: 4,
  Console: 5,
  NetworkSummary: 6
};
var HostedRunnerStoppedError = class extends Error {
  constructor(status, message, errorMessage) {
    super(message);
    this.status = status;
    this.errorMessage = errorMessage;
    this.name = "HostedRunnerStoppedError";
  }
  status;
  errorMessage;
};
async function runHostedRunner(config, options = {}) {
  const testDefinitions = config.payload.testSource?.tests ?? [];
  const implementations = testDefinitions.map(toCliRunImplementation);
  const baseUrl = config.payload.project?.baseUrl ?? config.payload.environment?.baseUrl ?? null;
  const perTestTimeoutMs = config.limits.perTestTimeoutSeconds * 1e3;
  const maxArtifactSizeBytes = config.limits.maxArtifactSizeBytes;
  const testExecutor = options.testExecutor ?? runPlaywrightTests;
  const resultReporter = options.resultReporter ?? createDefaultResultReporter(config);
  const heartbeatMonitor = createHeartbeatMonitor(
    config,
    resultReporter,
    options.heartbeatIntervalMs ?? 3e4
  );
  if (isGenerationRun(config.payload.project?.runKind)) {
    const agentGenerator = options.agentGenerator ?? runAgentGeneration;
    let result;
    try {
      heartbeatMonitor.start();
      result = await agentGenerator({
        apiUrl: config.apiUrl,
        apiKey: config.sessionToken,
        timeoutMs: hostedAgentTimeoutMs(config),
        userAgent: "testmutant-hosted-runner",
        runId: config.runId,
        baseUrl,
        webSocketUrl: buildHostedAgentWebSocketUrl(
          config.apiUrl,
          config.projectId,
          config.runId
        )
      });
      heartbeatMonitor.throwIfStopped();
    } finally {
      await heartbeatMonitor.stop();
    }
    const validationSummary = result.validationSummary;
    return {
      runId: config.runId,
      projectId: config.projectId,
      status: validationSummary && validationSummary.failed > 0 ? "Failed" : "Passed",
      totalTests: validationSummary?.total ?? 0,
      passedTests: validationSummary?.passed ?? 0,
      failedTests: validationSummary?.failed ?? 0,
      durationMs: 0,
      artifactsUploaded: 0
    };
  }
  const startedAtUtc = (/* @__PURE__ */ new Date()).toISOString();
  let testSummary;
  try {
    heartbeatMonitor.start();
    testSummary = await executeTests(testExecutor, implementations, {
      baseUrl,
      perTestTimeoutMs,
      traceMode: "retain-on-failure",
      videoMode: "retain-on-failure",
      captureRepairFeedback: true,
      signal: heartbeatMonitor.signal
    });
    heartbeatMonitor.throwIfStopped();
  } catch (error) {
    if (error instanceof HostedRunnerStoppedError) {
      const completedAtUtc2 = (/* @__PURE__ */ new Date()).toISOString();
      const durationMs2 = new Date(completedAtUtc2).getTime() - new Date(startedAtUtc).getTime();
      await completeStoppedRun(
        resultReporter,
        config,
        error,
        implementations.length,
        baseUrl,
        startedAtUtc,
        completedAtUtc2,
        durationMs2
      );
      return {
        runId: config.runId,
        projectId: config.projectId,
        status: error.status,
        totalTests: implementations.length,
        passedTests: 0,
        failedTests: 0,
        durationMs: durationMs2,
        artifactsUploaded: 0
      };
    }
    throw error;
  } finally {
    await heartbeatMonitor.stop();
  }
  const completedAtUtc = (/* @__PURE__ */ new Date()).toISOString();
  const durationMs = new Date(completedAtUtc).getTime() - new Date(startedAtUtc).getTime();
  let artifactsUploaded = 0;
  for (const test of testSummary.tests) {
    heartbeatMonitor.throwIfStopped();
    const resultStatus = test.status === "Passed" ? ResultStatus.Passed : ResultStatus.Failed;
    const initialOutputJson = buildRepairFeedbackOutput(test, null, null);
    const baseRequest = buildTestResultRequest(
      resultStatus,
      baseUrl,
      startedAtUtc,
      completedAtUtc,
      test,
      initialOutputJson
    );
    const { resultId, validationAttemptId } = await resultReporter.reportTestResult(
      config.projectId,
      config.runId,
      test.implementationId,
      baseRequest
    ).catch(() => ({ resultId: null, validationAttemptId: null }));
    const artifactUploads = await uploadTestArtifacts(
      resultReporter,
      config.projectId,
      config.runId,
      resultId,
      validationAttemptId,
      test,
      maxArtifactSizeBytes
    );
    artifactsUploaded += artifactUploads.uploadedCount;
    heartbeatMonitor.throwIfStopped();
    const finalOutputJson = buildRepairFeedbackOutput(
      test,
      artifactUploads,
      validationAttemptId
    );
    if (finalOutputJson && finalOutputJson !== initialOutputJson) {
      await resultReporter.reportTestResult(config.projectId, config.runId, test.implementationId, {
        ...baseRequest,
        outputJson: finalOutputJson
      }).catch(() => ({ resultId: null, validationAttemptId: null }));
    }
  }
  const passed = testSummary.failed === 0 && testSummary.total > 0;
  const runStatus = passed ? RunStatus.Completed : RunStatus.Failed;
  await resultReporter.completeRunResults(config.projectId, config.runId, {
    status: runStatus,
    summary: testSummary.total === 0 ? "No tests were provided for execution." : `Executed ${testSummary.total} test${testSummary.total === 1 ? "" : "s"}: ${testSummary.passed} passed, ${testSummary.failed} failed.`,
    errorMessage: passed ? null : testSummary.total === 0 ? "No tests were provided for execution." : `${testSummary.failed} test${testSummary.failed === 1 ? "" : "s"} failed.`,
    totalTests: testSummary.total,
    passedTests: testSummary.passed,
    failedTests: testSummary.failed,
    durationMs,
    environmentUrl: baseUrl,
    startedAtUtc,
    completedAtUtc
  });
  return {
    runId: config.runId,
    projectId: config.projectId,
    status: passed ? "Passed" : "Failed",
    totalTests: testSummary.total,
    passedTests: testSummary.passed,
    failedTests: testSummary.failed,
    durationMs,
    artifactsUploaded
  };
}
function isGenerationRun(runKind) {
  return runKind === RunKind.Generation || String(runKind).toLowerCase() === "generation";
}
function hostedAgentTimeoutMs(config) {
  return Math.max(3e4, Math.max(1, Number(config.limits.runTimeoutSeconds)) * 1e3);
}
function createHeartbeatMonitor(config, reporter, intervalMs) {
  const controller = new AbortController();
  let stopped = false;
  let loop = null;
  let tokenExpiryTimeout = null;
  let runTimeout = null;
  let stopReason = null;
  const stopWith = (reason) => {
    if (stopReason) {
      return;
    }
    stopReason = reason;
    controller.abort(reason);
  };
  const clearTokenExpiryTimeout = () => {
    if (tokenExpiryTimeout) {
      clearTimeout(tokenExpiryTimeout);
      tokenExpiryTimeout = null;
    }
  };
  const clearRunTimeout = () => {
    if (runTimeout) {
      clearTimeout(runTimeout);
      runTimeout = null;
    }
  };
  const scheduleTokenExpiry = (expiresAtUtc) => {
    const expiresAtMs = new Date(expiresAtUtc).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }
    clearTokenExpiryTimeout();
    const delayMs = Math.max(0, expiresAtMs - Date.now() - 1e3);
    tokenExpiryTimeout = setTimeout(() => {
      stopWith(
        new HostedRunnerStoppedError(
          "TimedOut",
          "Hosted runner session token expired.",
          "Hosted runner session token expired before the run completed."
        )
      );
    }, delayMs);
  };
  const scheduleRunTimeout = () => {
    const delayMs = Math.max(1e-3, config.limits.runTimeoutSeconds) * 1e3;
    runTimeout = setTimeout(() => {
      stopWith(
        new HostedRunnerStoppedError(
          "TimedOut",
          "Hosted runner job exceeded the run timeout.",
          `Hosted runner timed out after ${config.limits.runTimeoutSeconds} seconds.`
        )
      );
    }, delayMs);
  };
  const sendHeartbeat = async () => {
    const heartbeat = await reporter.heartbeat(config.projectId, config.runId);
    if (stopped || controller.signal.aborted) {
      return;
    }
    if (!heartbeat.ok) {
      stopWith(
        new HostedRunnerStoppedError(
          "Cancelled",
          "Hosted runner heartbeat was rejected.",
          "Hosted runner heartbeat was rejected by the API."
        )
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
                message
              )
            );
            break;
          }
          await wait(normalizedIntervalMs, controller.signal);
        }
      })().catch(() => {
      });
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
    }
  };
}
function wait(ms, signal) {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve3) => {
    const timeout2 = setTimeout(resolve3, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout2);
        resolve3();
      },
      { once: true }
    );
  });
}
async function completeStoppedRun(reporter, config, error, totalTests, environmentUrl, startedAtUtc, completedAtUtc, durationMs) {
  const runStatus = error.status === "Cancelled" ? RunStatus.Cancelled : RunStatus.TimedOut;
  await reporter.completeRunResults(config.projectId, config.runId, {
    status: runStatus,
    summary: error.message,
    errorMessage: error.errorMessage,
    totalTests,
    passedTests: 0,
    failedTests: 0,
    durationMs,
    environmentUrl,
    startedAtUtc,
    completedAtUtc
  }).catch(() => {
  });
}
function toCliRunImplementation(test) {
  return {
    implementationId: test.implementationId,
    testSpecId: test.testSpecId,
    testLayer: test.testLayer,
    runnerKind: test.runnerKind,
    name: test.name,
    source: test.source
  };
}
async function executeTests(testExecutor, implementations, options) {
  if (implementations.length === 0) {
    return {
      kind: "playwright",
      baseUrl: options.baseUrl,
      total: 0,
      passed: 0,
      failed: 0,
      tests: []
    };
  }
  try {
    const summary = await testExecutor(implementations, {
      baseUrl: options.baseUrl,
      perTestTimeoutMs: options.perTestTimeoutMs,
      traceMode: options.traceMode,
      videoMode: options.videoMode,
      captureRepairFeedback: options.captureRepairFeedback,
      signal: options.signal
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
        status: "Failed",
        errorMessage: message,
        durationMs: null,
        screenshotBuffer: null,
        traceBuffer: null,
        videoBuffer: null
      }))
    };
  }
}
function getHostedRunnerStopReason(signal) {
  return signal?.aborted && signal.reason instanceof HostedRunnerStoppedError ? signal.reason : null;
}
async function uploadTestArtifacts(reporter, projectId, runId, resultId, validationAttemptId, test, maxArtifactSizeBytes) {
  const artifacts = [];
  if (test.screenshotBuffer) {
    artifacts.push({
      key: "screenshot",
      kind: ArtifactKind.Screenshot,
      fileName: `${safeFilePart2(test.implementationId)}-screenshot.png`,
      contentType: "image/png",
      buffer: test.screenshotBuffer
    });
  }
  if (test.traceBuffer) {
    artifacts.push({
      key: "trace",
      kind: ArtifactKind.Trace,
      fileName: `${safeFilePart2(test.implementationId)}-trace.zip`,
      contentType: "application/zip",
      buffer: test.traceBuffer
    });
  }
  if (test.videoBuffer) {
    artifacts.push({
      key: "video",
      kind: ArtifactKind.Video,
      fileName: `${safeFilePart2(test.implementationId)}-video.webm`,
      contentType: "video/webm",
      buffer: test.videoBuffer
    });
  }
  let uploaded = 0;
  const references = {
    uploadedCount: 0,
    screenshot: null,
    trace: null,
    video: null
  };
  for (const artifact of artifacts) {
    if (artifact.buffer.byteLength > maxArtifactSizeBytes) {
      references[artifact.key] = {
        artifactId: null,
        fileName: artifact.fileName,
        contentType: artifact.contentType
      };
      continue;
    }
    const response = await reporter.uploadArtifact(projectId, runId, {
      kind: artifact.kind,
      fileName: artifact.fileName,
      contentType: artifact.contentType,
      contentBase64: artifact.buffer.toString("base64"),
      runImplementationResultId: resultId,
      validationAttemptId
    }).catch(() => ({
      artifactId: null,
      fileName: artifact.fileName,
      contentType: artifact.contentType
    }));
    references[artifact.key] = {
      artifactId: response.artifactId,
      fileName: response.fileName ?? artifact.fileName,
      contentType: response.contentType ?? artifact.contentType
    };
    if (response.artifactId) {
      uploaded += 1;
    }
  }
  return {
    ...references,
    uploadedCount: uploaded
  };
}
function safeFilePart2(value) {
  return value.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "test";
}
function buildTestResultRequest(resultStatus, baseUrl, startedAtUtc, completedAtUtc, test, outputJson) {
  return {
    status: resultStatus,
    durationMs: test.durationMs,
    errorMessage: test.errorMessage,
    environmentUrl: baseUrl,
    startedAtUtc,
    completedAtUtc,
    outputJson
  };
}
function buildRepairFeedbackOutput(test, uploads, validationAttemptId) {
  if (test.status !== "Failed") {
    return null;
  }
  const consoleLogs = normalizeFeedbackEntries(test.repairFeedback?.consoleLogs);
  const browserObservations = normalizeFeedbackEntries(
    test.repairFeedback?.browserObservations
  );
  const screenshotReference = buildArtifactReference(
    uploads?.screenshot ?? (test.screenshotBuffer ? defaultArtifactReference(test, "screenshot") : null),
    validationAttemptId
  );
  const traceSummary = buildTraceSummary(
    uploads?.trace ?? (test.traceBuffer ? defaultArtifactReference(test, "trace") : null),
    validationAttemptId
  );
  if (!test.errorMessage && !screenshotReference && !traceSummary && consoleLogs.length === 0 && browserObservations.length === 0) {
    return null;
  }
  return JSON.stringify({
    errorMessage: test.errorMessage,
    screenshotReference,
    traceSummary,
    consoleLogs,
    browserObservations
  });
}
function buildArtifactReference(reference, validationAttemptId) {
  if (!reference) {
    return null;
  }
  return {
    artifactId: reference.artifactId,
    validationAttemptId,
    fileName: reference.fileName,
    contentType: reference.contentType,
    uploaded: Boolean(reference.artifactId)
  };
}
function buildTraceSummary(reference, validationAttemptId) {
  if (!reference) {
    return null;
  }
  return {
    artifactId: reference.artifactId,
    validationAttemptId,
    fileName: reference.fileName,
    contentType: reference.contentType,
    uploaded: Boolean(reference.artifactId),
    summary: reference.artifactId ? `Playwright trace uploaded as ${reference.fileName ?? "trace.zip"}.` : `Playwright trace was captured locally as ${reference.fileName ?? "trace.zip"} but was not uploaded.`
  };
}
function defaultArtifactReference(test, kind) {
  return kind === "screenshot" ? {
    artifactId: null,
    fileName: `${safeFilePart2(test.implementationId)}-screenshot.png`,
    contentType: "image/png"
  } : {
    artifactId: null,
    fileName: `${safeFilePart2(test.implementationId)}-trace.zip`,
    contentType: "application/zip"
  };
}
function normalizeFeedbackEntries(entries) {
  if (!entries) {
    return [];
  }
  return entries.map((entry) => entry.trim()).filter(Boolean).slice(0, 20);
}
function createDefaultResultReporter(config) {
  const client = new HostedRunnerApiClient({
    apiUrl: config.apiUrl,
    sessionToken: config.sessionToken,
    timeoutMs: 3e4
  });
  return {
    async heartbeat(projectId, runId) {
      return client.heartbeat(projectId, runId);
    },
    async reportTestResult(projectId, runId, implementationId, request) {
      const response = await client.reportTestResult(projectId, runId, implementationId, request);
      return {
        resultId: response.resultId,
        validationAttemptId: response.validationAttemptId ?? null
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
        contentType: response.contentType
      };
    }
  };
}

// src/environment-check.ts
var import_playwright3 = require("playwright");
init_playwright_install();
var EnvironmentCheckStatus = {
  Ready: 3,
  BaseUrlUnreachable: 4,
  LoginFailed: 5,
  Timeout: 6,
  NeedsConfiguration: 7
};
var AuthMode = {
  None: 1,
  UsernamePassword: 2,
  CustomInstructions: 3
};
async function executeEnvironmentCheck(context, options = {}) {
  const configError = validateConfiguration(context);
  if (configError) {
    return configError;
  }
  const driver = options.browserDriver ?? playwrightBrowserDriver;
  try {
    const result = await driver(context);
    return {
      ...result,
      statusReason: result.statusReason ? redactSecrets(result.statusReason, context) : null
    };
  } catch (error) {
    const isTimeout2 = isTimeoutError2(error);
    return {
      status: isTimeout2 ? EnvironmentCheckStatus.Timeout : EnvironmentCheckStatus.BaseUrlUnreachable,
      statusReason: redactSecrets(extractErrorMessage(error), context),
      screenshotBuffer: null
    };
  }
}
function validateConfiguration(context) {
  if (!context.baseUrl) {
    return {
      status: EnvironmentCheckStatus.NeedsConfiguration,
      statusReason: "Base URL is required.",
      screenshotBuffer: null
    };
  }
  try {
    const url = new URL(context.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        status: EnvironmentCheckStatus.NeedsConfiguration,
        statusReason: "Base URL must use http or https.",
        screenshotBuffer: null
      };
    }
  } catch {
    return {
      status: EnvironmentCheckStatus.NeedsConfiguration,
      statusReason: "Base URL must be an absolute URL.",
      screenshotBuffer: null
    };
  }
  if (context.loginUrl) {
    try {
      new URL(context.loginUrl);
    } catch {
      return {
        status: EnvironmentCheckStatus.NeedsConfiguration,
        statusReason: "Login URL must be an absolute URL.",
        screenshotBuffer: null
      };
    }
  }
  if (context.authMode === AuthMode.UsernamePassword && (!context.username || !context.password)) {
    return {
      status: EnvironmentCheckStatus.NeedsConfiguration,
      statusReason: "Username/password authentication requires staging credentials.",
      screenshotBuffer: null
    };
  }
  return null;
}
async function playwrightBrowserDriver(context) {
  await ensurePlaywrightBrowserInstalled();
  const startMs = Date.now();
  const browser = await import_playwright3.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const remaining1 = remainingMs(startMs, context.timeoutMs);
    if (remaining1 <= 0) {
      return timeoutResult("Environment check timed out before navigating to the base URL.");
    }
    try {
      const response = await page.goto(context.baseUrl, {
        waitUntil: "load",
        timeout: remaining1
      });
      if (response && !isSuccessStatus(response.status())) {
        return {
          status: EnvironmentCheckStatus.BaseUrlUnreachable,
          statusReason: `Received HTTP ${response.status()} from ${hostOf(context.baseUrl)}.`,
          screenshotBuffer: await takeScreenshot(page)
        };
      }
    } catch (error) {
      return {
        status: isTimeoutError2(error) ? EnvironmentCheckStatus.Timeout : EnvironmentCheckStatus.BaseUrlUnreachable,
        statusReason: extractErrorMessage(error),
        screenshotBuffer: await takeScreenshot(page)
      };
    }
    if (context.authMode === AuthMode.None && !context.loginUrl) {
      return {
        status: EnvironmentCheckStatus.Ready,
        statusReason: "Base URL is reachable.",
        screenshotBuffer: await takeScreenshot(page)
      };
    }
    if (context.loginUrl) {
      const remaining2 = remainingMs(startMs, context.timeoutMs);
      if (remaining2 <= 0) {
        return timeoutResult("Environment check timed out before navigating to the login page.");
      }
      try {
        const response = await page.goto(context.loginUrl, {
          waitUntil: "load",
          timeout: remaining2
        });
        if (response && !isSuccessStatus(response.status())) {
          return {
            status: EnvironmentCheckStatus.LoginFailed,
            statusReason: `Received HTTP ${response.status()} from login page.`,
            screenshotBuffer: await takeScreenshot(page)
          };
        }
      } catch (error) {
        return {
          status: isTimeoutError2(error) ? EnvironmentCheckStatus.Timeout : EnvironmentCheckStatus.LoginFailed,
          statusReason: extractErrorMessage(error),
          screenshotBuffer: await takeScreenshot(page)
        };
      }
    }
    if (context.authMode === AuthMode.UsernamePassword && context.username && context.password) {
      const loginError = await performCredentialLogin(page, context, startMs);
      if (loginError) {
        return loginError;
      }
    }
    if (context.postLoginVerificationHint) {
      const hintError = await verifyPostLoginHint(page, context, startMs);
      if (hintError) {
        return hintError;
      }
    }
    return {
      status: EnvironmentCheckStatus.Ready,
      statusReason: buildSuccessReason(context),
      screenshotBuffer: await takeScreenshot(page)
    };
  } finally {
    await browser.close();
  }
}
async function performCredentialLogin(page, context, startMs) {
  const remaining = remainingMs(startMs, context.timeoutMs);
  if (remaining <= 0) {
    return timeoutResult("Environment check timed out before performing login.");
  }
  try {
    const usernameInput = await findUsernameField(page, remaining);
    if (!usernameInput) {
      return {
        status: EnvironmentCheckStatus.LoginFailed,
        statusReason: "Could not find a username or email input field on the login page.",
        screenshotBuffer: await takeScreenshot(page)
      };
    }
    const passwordInput = page.locator('input[type="password"]').first();
    const hasPassword = await passwordInput.waitFor({ state: "visible", timeout: Math.min(5e3, remaining) }).then(() => true).catch(() => false);
    if (!hasPassword) {
      return {
        status: EnvironmentCheckStatus.LoginFailed,
        statusReason: "Could not find a password input field on the login page.",
        screenshotBuffer: await takeScreenshot(page)
      };
    }
    await usernameInput.fill(context.username);
    await passwordInput.fill(context.password);
    await passwordInput.press("Enter");
    const settleTimeout = Math.min(
      1e4,
      remainingMs(startMs, context.timeoutMs)
    );
    if (settleTimeout > 0) {
      await page.waitForLoadState("networkidle", { timeout: settleTimeout }).catch(() => {
      });
    }
  } catch (error) {
    return {
      status: isTimeoutError2(error) ? EnvironmentCheckStatus.Timeout : EnvironmentCheckStatus.LoginFailed,
      statusReason: extractErrorMessage(error),
      screenshotBuffer: await takeScreenshot(page)
    };
  }
  return null;
}
async function verifyPostLoginHint(page, context, startMs) {
  const remaining = remainingMs(startMs, context.timeoutMs);
  if (remaining <= 0) {
    return timeoutResult(
      "Environment check timed out before verifying post-login hint."
    );
  }
  const hint = context.postLoginVerificationHint;
  try {
    await page.getByText(hint, { exact: false }).first().waitFor({ state: "visible", timeout: remaining });
  } catch {
    return {
      status: EnvironmentCheckStatus.LoginFailed,
      statusReason: `Post-login verification failed: could not find "${truncate3(hint, 100)}" on the page after login.`,
      screenshotBuffer: await takeScreenshot(page)
    };
  }
  return null;
}
var USERNAME_SELECTORS2 = [
  'input[type="email"]:visible',
  'input[name="email"]:visible',
  'input[name="username"]:visible',
  'input[name="user"]:visible',
  'input[name="login"]:visible',
  'input[id="email"]:visible',
  'input[id="username"]:visible',
  'input[id="login"]:visible',
  'input[autocomplete="username"]:visible',
  'input[autocomplete="email"]:visible',
  'input[type="text"]:visible'
];
async function findUsernameField(page, timeoutMs) {
  const waitTimeout = Math.min(5e3, timeoutMs);
  for (const selector of USERNAME_SELECTORS2) {
    const locator = page.locator(selector).first();
    const found = await locator.waitFor({ state: "visible", timeout: waitTimeout }).then(() => true).catch(() => false);
    if (found) {
      return locator;
    }
  }
  return null;
}
async function takeScreenshot(page) {
  try {
    return await page.screenshot({ type: "png", fullPage: false });
  } catch {
    return null;
  }
}
function timeoutResult(reason) {
  return {
    status: EnvironmentCheckStatus.Timeout,
    statusReason: reason,
    screenshotBuffer: null
  };
}
function remainingMs(startMs, totalMs) {
  return Math.max(0, totalMs - (Date.now() - startMs));
}
function isSuccessStatus(status) {
  return status >= 200 && status < 400;
}
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function buildSuccessReason(context) {
  if (context.authMode === AuthMode.UsernamePassword && context.username && context.password) {
    return context.postLoginVerificationHint ? "Base URL is reachable, login succeeded, and post-login verification passed." : "Base URL is reachable and login succeeded.";
  }
  if (context.loginUrl) {
    return context.authMode === AuthMode.CustomInstructions ? "Base URL and login page are reachable; custom login instructions are available to the hosted runner." : "Base URL and login page are reachable.";
  }
  return "Base URL is reachable.";
}
function isTimeoutError2(error) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return true;
    }
    const message = error.message.toLowerCase();
    return message.includes("timeout") && (message.includes("exceeded") || message.includes("navigation") || message.includes("waiting"));
  }
  return false;
}
function extractErrorMessage(error) {
  if (error instanceof Error) {
    return truncate3(error.message);
  }
  return truncate3(String(error));
}
function redactSecrets(message, context) {
  let result = message;
  const secrets = [context.username, context.password].filter(
    (value) => Boolean(value && value.length > 0)
  );
  for (const secret of secrets) {
    result = replaceAll(result, secret, "[REDACTED]");
  }
  return result;
}
function replaceAll(input, search, replacement) {
  if (!search) {
    return input;
  }
  let result = input;
  let index = result.indexOf(search);
  while (index !== -1) {
    result = result.slice(0, index) + replacement + result.slice(index + search.length);
    index = result.indexOf(search, index + replacement.length);
  }
  return result;
}
function truncate3(value, maxLength = 1e3) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

// src/hosted-environment-check.ts
var SCREENSHOT_ARTIFACT_KIND = 0;
async function runHostedEnvironmentCheck(config, options = {}) {
  const checkResult = await executeEnvironmentCheck(config.context, {
    browserDriver: options.browserDriver
  });
  let artifactId = null;
  if (checkResult.screenshotBuffer) {
    const uploader = options.artifactUploader ?? createDefaultUploader(config);
    artifactId = await uploadScreenshot(
      uploader,
      config.projectId,
      config.runId,
      checkResult.screenshotBuffer
    );
  }
  return {
    status: checkResult.status,
    statusReason: checkResult.statusReason,
    artifactId
  };
}
async function uploadScreenshot(uploader, projectId, runId, screenshot) {
  try {
    return await uploader(projectId, runId, {
      kind: SCREENSHOT_ARTIFACT_KIND,
      fileName: "environment-check-screenshot.png",
      contentType: "image/png",
      contentBase64: screenshot.toString("base64")
    });
  } catch {
    return null;
  }
}
function createDefaultUploader(config) {
  const client = new HostedRunnerApiClient({
    apiUrl: config.apiUrl,
    sessionToken: config.sessionToken,
    timeoutMs: 3e4
  });
  return async (projectId, runId, request) => {
    const response = await client.uploadArtifact(projectId, runId, request);
    return response.artifactId;
  };
}

// src/hosted-runner-config.ts
init_config();
var HOSTED_RUNNER_JOB_ID_ENV_VAR = "TESTMUTANT_HOSTED_RUNNER_JOB_ID";
var ORGANIZATION_ID_ENV_VAR = "TESTMUTANT_ORGANIZATION_ID";
var PROJECT_ID_ENV_VAR = "TESTMUTANT_PROJECT_ID";
var RUN_ID_ENV_VAR = "TESTMUTANT_RUN_ID";
var RUNNER_SESSION_TOKEN_ENV_VAR = "TESTMUTANT_RUNNER_SESSION_TOKEN";
var HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR = "TESTMUTANT_HOSTED_RUNNER_PAYLOAD_JSON";
var ENVIRONMENT_CONFIGURATION_ID_ENV_VAR = "TESTMUTANT_ENVIRONMENT_CONFIGURATION_ID";
var RUN_TIMEOUT_SECONDS_ENV_VAR = "TESTMUTANT_RUN_TIMEOUT_SECONDS";
var PER_TEST_TIMEOUT_SECONDS_ENV_VAR = "TESTMUTANT_PER_TEST_TIMEOUT_SECONDS";
var MAX_TESTS_PER_RUN_ENV_VAR = "TESTMUTANT_MAX_TESTS_PER_RUN";
var MAX_ARTIFACT_SIZE_BYTES_ENV_VAR = "TESTMUTANT_MAX_ARTIFACT_SIZE_BYTES";
var MAX_REPAIR_ATTEMPTS_ENV_VAR = "TESTMUTANT_MAX_REPAIR_ATTEMPTS";
var ENVIRONMENT_CHECK_ID_ENV_VAR = "TESTMUTANT_ENVIRONMENT_CHECK_ID";
var ENVIRONMENT_CHECK_TIMEOUT_SECONDS_ENV_VAR = "TESTMUTANT_ENVIRONMENT_CHECK_TIMEOUT_SECONDS";
function resolveHostedRunnerConfig() {
  const hostedRunnerJobId = requireEnv(HOSTED_RUNNER_JOB_ID_ENV_VAR);
  const organizationId = requireEnv(ORGANIZATION_ID_ENV_VAR);
  const projectId = requireEnv(PROJECT_ID_ENV_VAR);
  const runId = requireEnv(RUN_ID_ENV_VAR);
  const sessionToken = requireEnv(RUNNER_SESSION_TOKEN_ENV_VAR);
  const payloadJson = requireEnv(HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR);
  const apiUrl = process.env[API_URL_ENV_VAR]?.trim() || DEFAULT_API_URL;
  const environmentConfigurationId = process.env[ENVIRONMENT_CONFIGURATION_ID_ENV_VAR]?.trim() || null;
  const payload = parsePayloadJson(payloadJson);
  return {
    hostedRunnerJobId,
    organizationId,
    projectId,
    runId,
    sessionToken,
    apiUrl: normalizeUrl2(apiUrl),
    environmentConfigurationId,
    payload,
    limits: {
      runTimeoutSeconds: parsePositiveInt(RUN_TIMEOUT_SECONDS_ENV_VAR, 1800),
      perTestTimeoutSeconds: parsePositiveInt(PER_TEST_TIMEOUT_SECONDS_ENV_VAR, 60),
      maxTestsPerRun: parsePositiveInt(MAX_TESTS_PER_RUN_ENV_VAR, 25),
      maxArtifactSizeBytes: parsePositiveInt(MAX_ARTIFACT_SIZE_BYTES_ENV_VAR, 50 * 1024 * 1024),
      maxRepairAttempts: parsePositiveInt(MAX_REPAIR_ATTEMPTS_ENV_VAR, 2)
    }
  };
}
function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CliError(
      `Hosted runner mode requires ${name} to be set.`,
      2
    );
  }
  return value;
}
function parsePositiveInt(envVar, defaultValue) {
  const raw = process.env[envVar]?.trim();
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}
function parsePayloadJson(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: invalid JSON.`,
      2
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: expected a JSON object.`,
      2
    );
  }
  const payload = parsed;
  if (!payload.project || typeof payload.project !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: missing project context.`,
      2
    );
  }
  if (!payload.testSource || typeof payload.testSource !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: missing test source.`,
      2
    );
  }
  if (!payload.limits || typeof payload.limits !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: missing limits.`,
      2
    );
  }
  if (!payload.artifactUploads || typeof payload.artifactUploads !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: missing artifact upload instructions.`,
      2
    );
  }
  return parsed;
}
function resolveEnvironmentCheckConfig() {
  const hostedRunnerJobId = requireEnv(HOSTED_RUNNER_JOB_ID_ENV_VAR);
  const organizationId = requireEnv(ORGANIZATION_ID_ENV_VAR);
  const projectId = requireEnv(PROJECT_ID_ENV_VAR);
  const runId = requireEnv(RUN_ID_ENV_VAR);
  const sessionToken = requireEnv(RUNNER_SESSION_TOKEN_ENV_VAR);
  const payloadJson = requireEnv(HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR);
  const environmentCheckId = requireEnv(ENVIRONMENT_CHECK_ID_ENV_VAR);
  const apiUrl = process.env[API_URL_ENV_VAR]?.trim() || DEFAULT_API_URL;
  const environmentConfigurationId = process.env[ENVIRONMENT_CONFIGURATION_ID_ENV_VAR]?.trim() || null;
  const timeoutSeconds = parsePositiveInt(
    ENVIRONMENT_CHECK_TIMEOUT_SECONDS_ENV_VAR,
    30
  );
  const payload = parsePayloadJson(payloadJson);
  const environment = payload.environment;
  if (!environment) {
    throw new CliError(
      "Environment check mode requires an environment configuration in the hosted runner payload.",
      2
    );
  }
  const auth = environment.auth;
  const authMode = typeof auth?.authMode === "number" ? auth.authMode : AuthMode.None;
  const context = {
    baseUrl: environment.baseUrl ?? "",
    authMode,
    loginUrl: auth?.loginUrl ?? null,
    loginInstructions: auth?.loginInstructions ?? null,
    username: auth?.username ?? null,
    password: auth?.password ?? null,
    postLoginVerificationHint: auth?.postLoginVerificationHint ?? null,
    timeoutMs: timeoutSeconds * 1e3
  };
  return {
    hostedRunnerJobId,
    organizationId,
    projectId,
    runId,
    sessionToken,
    apiUrl: normalizeUrl2(apiUrl),
    environmentConfigurationId: environmentConfigurationId ?? environment.environmentConfigurationId,
    environmentCheckId,
    timeoutSeconds,
    context
  };
}
function normalizeUrl2(value) {
  return value.replace(/\/$/, "");
}

// src/index.ts
var import_commander = require("commander");
init_config();
var packageInfo = readPackageInfo();
var program = new import_commander.Command();
program.name("testmutant").description("Run TestMutant workflows locally or in CI.").version(packageInfo.version).option("-k, --api-key <key>", `TestMutant API key. Defaults to ${API_KEY_ENV_VAR}.`).option(
  "-u, --api-url <url>",
  `TestMutant API base URL. Defaults to ${API_URL_ENV_VAR} or ${DEFAULT_API_URL}.`
).option("--timeout <ms>", "API request timeout in milliseconds.", "30000").option("--json", "Print command output as JSON.");
program.hook("preAction", async (_thisCommand, actionCommand) => {
  const options = program.opts();
  if (options.json || actionCommand.name() === "runner-service") {
    return;
  }
  await printUpdateReminder(packageInfo);
});
program.command("runner-service").description("Start the internal HTTP Playwright runner service.").option("--host <host>", "Host to bind. Defaults to TESTMUTANT_RUNNER_HOST or 0.0.0.0.").option("--port <port>", "Port to bind. Defaults to TESTMUTANT_RUNNER_PORT or 8080.").option("--token <token>", "Internal bearer token. Defaults to TESTMUTANT_RUNNER_TOKEN.").option("--runner-instance-id <id>", "Runner instance id.").option("--artifact-dir <path>", "Artifact root directory.").option("--max-sessions <number>", "Maximum concurrent browser sessions.").option("--session-timeout-ms <number>", "Session timeout in milliseconds.").option("--headless <true|false>", "Run Chromium headless.").action(async (commandOptions) => {
  await runRunnerServiceCommand(commandOptions, packageInfo.version);
});
program.command("ping").description("Verify the CLI can authenticate with the TestMutant API.").action(async () => {
  const options = program.opts();
  const config = resolveConfig(options);
  const client = new TestMutantApiClient({
    ...config,
    userAgent: `testmutant-cli/${packageInfo.version}`
  });
  const ping = await client.ping();
  if (options.json) {
    console.log(JSON.stringify(ping, null, 2));
    return;
  }
  console.log("Connected to TestMutant.");
  console.log(`Organization: ${ping.organizationName} (${ping.organizationId})`);
  console.log(`CLI API version: ${ping.cliApiVersion}`);
});
program.command("run").description("Execute test implementations and report results.").argument("[url]", "Application base URL.").option("--run-kind <kind>", "Run kind: Execution or Advisory.", "Execution").option("--repository <repository>", "Repository full name override, e.g. owner/repo.").option("--provider <provider>", "Repository provider.", "GitHub").option("--base-url <url>", "Application base URL.").option("--environment <name>", "Environment name.").option("--test-spec-id <id>", "Test spec id to scope the run.").action(
  async (url, commandOptions) => {
    const options = program.opts();
    const result = await runCi({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      timeout: options.timeout,
      runKind: commandOptions.runKind,
      repository: commandOptions.repository,
      provider: commandOptions.provider,
      baseUrl: url ?? commandOptions.baseUrl,
      environmentName: commandOptions.environment,
      testSpecId: commandOptions.testSpecId,
      userAgent: `testmutant-cli/${packageInfo.version}`
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Run ID: ${result.runId}`);
    console.log(`Status: ${result.status}`);
    console.log(
      `Tests: ${result.passedTests}/${result.totalTests} passed, ${result.failedTests} failed`
    );
  }
);
program.command("generate").description("Generate test implementations via the TestMutant agent.").argument("[url]", "Application base URL.").option("--repository <repository>", "Repository full name override, e.g. owner/repo.").option("--provider <provider>", "Repository provider.", "GitHub").option("--base-url <url>", "Application base URL.").option("--environment <name>", "Environment name.").option("--test-spec-id <id>", "Test spec id for targeted generation.").action(
  async (url, commandOptions) => {
    const options = program.opts();
    const result = await runCi({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      timeout: options.timeout,
      runKind: "Generation",
      repository: commandOptions.repository,
      provider: commandOptions.provider,
      baseUrl: url ?? commandOptions.baseUrl,
      environmentName: commandOptions.environment,
      testSpecId: commandOptions.testSpecId,
      userAgent: `testmutant-cli/${packageInfo.version}`
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Run ID: ${result.runId}`);
    console.log(`Status: ${result.status}`);
    console.log(
      `Tests: ${result.passedTests}/${result.totalTests} passed, ${result.failedTests} failed`
    );
  }
);
var hostedRunCommand = program.command("hosted-run").description("Execute a hosted runner job using API-provided context. (Internal)").action(async () => {
  const options = program.opts();
  const config = resolveHostedRunnerConfig();
  const result = await runHostedRunner(config);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Hosted run completed.`);
  console.log(`Run ID: ${result.runId}`);
  console.log(`Project ID: ${result.projectId}`);
  console.log(`Status: ${result.status}`);
  console.log(
    `Tests: ${result.passedTests}/${result.totalTests} passed, ${result.failedTests} failed`
  );
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(`Artifacts uploaded: ${result.artifactsUploaded}`);
  if (result.status === "Failed") {
    throw new CliError(
      `Hosted run failed: ${result.failedTests} of ${result.totalTests} tests failed.`,
      1
    );
  }
  if (result.status === "Cancelled") {
    throw new CliError("Hosted run was cancelled.", 1);
  }
  if (result.status === "TimedOut") {
    throw new CliError("Hosted run timed out.", 124);
  }
});
hostedRunCommand.helpInformation = () => "";
var hostedEnvCheckCommand = program.command("hosted-env-check").description("Execute a hosted environment check using API-provided context. (Internal)").action(async () => {
  const options = program.opts();
  const config = resolveEnvironmentCheckConfig();
  const result = await runHostedEnvironmentCheck(config);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Environment check completed.`);
  console.log(`Check ID: ${config.environmentCheckId}`);
  console.log(`Status: ${result.status}`);
  if (result.statusReason) {
    console.log(`Reason: ${result.statusReason}`);
  }
  if (result.artifactId) {
    console.log(`Screenshot artifact: ${result.artifactId}`);
  }
});
hostedEnvCheckCommand.helpInformation = () => "";
program.showHelpAfterError();
program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
    return;
  }
  if (error instanceof Error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.error(String(error));
  process.exitCode = 1;
});
function readPackageInfo() {
  const packageJsonPath = (0, import_node_path8.join)(__dirname, "..", "package.json");
  const packageJson = JSON.parse((0, import_node_fs3.readFileSync)(packageJsonPath, "utf8"));
  return {
    name: typeof packageJson.name === "string" ? packageJson.name : "@testmutant/cli",
    version: typeof packageJson.version === "string" ? packageJson.version : "0.0.0"
  };
}
async function printUpdateReminder(packageInfo2) {
  const latestVersion = await fetchLatestPackageVersion(packageInfo2.name);
  if (!latestVersion || !isNewerVersion(latestVersion, packageInfo2.version)) {
    return;
  }
  console.log(
    `There is a newer TestMutant CLI version available (${packageInfo2.version} -> ${latestVersion}). Run npm install -g ${packageInfo2.name}@latest to update.`
  );
  console.log("");
}
async function fetchLatestPackageVersion(packageName) {
  const controller = new AbortController();
  const timeout2 = setTimeout(() => controller.abort(), 1e3);
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal
      }
    );
    if (!response.ok) {
      return null;
    }
    const body = await response.json();
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout2);
  }
}
function isNewerVersion(candidate, current) {
  const candidateVersion = parseSemver(candidate);
  const currentVersion = parseSemver(current);
  if (!candidateVersion || !currentVersion) {
    return candidate !== current;
  }
  for (const key of ["major", "minor", "patch"]) {
    if (candidateVersion[key] > currentVersion[key]) {
      return true;
    }
    if (candidateVersion[key] < currentVersion[key]) {
      return false;
    }
  }
  if (!candidateVersion.prerelease && currentVersion.prerelease) {
    return true;
  }
  if (candidateVersion.prerelease && !currentVersion.prerelease) {
    return false;
  }
  return Boolean(candidateVersion.prerelease && currentVersion.prerelease) && candidateVersion.prerelease > currentVersion.prerelease;
}
function parseSemver(value) {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ""
  };
}
