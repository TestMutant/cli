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
      }
      exitCode;
    };
  }
});

// src/playwright-install.ts
async function ensurePlaywrightBrowserInstalled() {
  const runtimeRequire = (0, import_node_module.createRequire)(__filename);
  const playwrightCliPath = (0, import_node_path.join)(
    (0, import_node_path.dirname)(runtimeRequire.resolve("playwright/package.json")),
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
  return new Promise((resolve) => {
    (0, import_node_child_process2.execFile)(
      process.execPath,
      args,
      {
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const exitCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ exitCode, stdout, stderr });
      }
    );
  });
}
var import_node_child_process2, import_node_module, import_node_path;
var init_playwright_install = __esm({
  "src/playwright-install.ts"() {
    "use strict";
    import_node_child_process2 = require("child_process");
    import_node_module = require("module");
    import_node_path = require("path");
    init_config();
  }
});

// src/playwright-runner.ts
async function runPlaywrightTests(tests, options = {}) {
  const supported = tests.filter(isPlaywrightTest);
  const unsupported = tests.filter((test) => !isPlaywrightTest(test));
  const unsupportedResults = unsupported.map((test) => ({
    testId: test.testId,
    type: test.type,
    name: test.name,
    status: "Failed",
    errorMessage: `Unsupported test type: ${test.type}`,
    durationMs: null
  }));
  if (supported.length === 0) {
    return summarize(options.baseUrl ?? null, unsupportedResults);
  }
  const workDir = await (0, import_promises.mkdtemp)((0, import_node_path2.join)((0, import_node_os.tmpdir)(), "testmutant-playwright-"));
  try {
    const writtenTests = await writePlaywrightWorkspace(
      workDir,
      supported,
      options.baseUrl ?? null
    );
    const commandRunner = options.commandRunner ?? defaultCommandRunner;
    await ensurePlaywrightBrowserInstalled();
    const result = await commandRunner(
      process.execPath,
      getPlaywrightTestArgs(workDir, writtenTests),
      {
        cwd: workDir,
        env: {
          ...process.env,
          NODE_PATH: buildNodePath(process.env.NODE_PATH)
        }
      }
    );
    const mappedResults = mapPlaywrightResults(writtenTests, result);
    return summarize(options.baseUrl ?? null, [
      ...mappedResults,
      ...unsupportedResults
    ]);
  } finally {
    await (0, import_promises.rm)(workDir, { recursive: true, force: true });
  }
}
function isPlaywrightTest(test) {
  return test.type.trim().toLowerCase() === PLAYWRIGHT_TYPE;
}
async function writePlaywrightWorkspace(workDir, tests, baseUrl) {
  await (0, import_promises.writeFile)(
    (0, import_node_path2.join)(workDir, "playwright.config.cjs"),
    [
      "module.exports = {",
      "  timeout: 30000,",
      "  workers: 1,",
      "  use: {",
      `    baseURL: ${JSON.stringify(baseUrl)},`,
      "  },",
      "};",
      ""
    ].join("\n"),
    "utf8"
  );
  const writtenTests = [];
  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index];
    const fileName = `${String(index + 1).padStart(3, "0")}-${safeFilePart(
      test.testId
    )}.spec.ts`;
    const filePath = (0, import_node_path2.join)(workDir, fileName);
    await (0, import_promises.writeFile)(filePath, test.source, "utf8");
    writtenTests.push({ test, filePath, fileName });
  }
  return writtenTests;
}
function mapPlaywrightResults(writtenTests, commandResult) {
  const report = parsePlaywrightReport(commandResult.stdout);
  const fileResults = /* @__PURE__ */ new Map();
  const fallbackError = firstReportError(report) ?? meaningfulStderr(commandResult.stderr) ?? extractUsefulPlaywrightFailure(commandResult.stdout);
  if (report) {
    for (const suite of report.suites ?? []) {
      collectSuiteResults(suite, writtenTests, fileResults, fallbackError);
    }
  }
  return writtenTests.map(({ test, fileName }) => {
    const mapped = fileResults.get(fileName);
    if (mapped) {
      return mapped;
    }
    return {
      testId: test.testId,
      type: test.type,
      name: test.name,
      status: commandResult.exitCode === 0 ? "Passed" : "Failed",
      errorMessage: commandResult.exitCode === 0 ? null : fallbackError,
      durationMs: null
    };
  });
}
function collectSuiteResults(suite, writtenTests, fileResults, fallbackError) {
  const fileName = suite.file ? suite.file.replace(/\\/g, "/").split("/").pop() : null;
  const writtenTest = fileName ? writtenTests.find((candidate) => candidate.fileName === fileName) : void 0;
  if (writtenTest && fileName) {
    const specs = suite.specs ?? [];
    const failedSpec = specs.find((spec) => spec.ok === false);
    const failedCase = specs.flatMap((spec) => spec.tests ?? []).find((testCase) => testCase.ok === false);
    const result = failedCase?.results?.find(
      (caseResult) => caseResult.status && caseResult.status !== "passed"
    );
    fileResults.set(fileName, {
      testId: writtenTest.test.testId,
      type: writtenTest.test.type,
      name: writtenTest.test.name,
      status: failedSpec || failedCase ? "Failed" : "Passed",
      errorMessage: failedSpec || failedCase ? formatResultError(result) ?? fallbackError ?? "Playwright test failed." : null,
      durationMs: sumDurations(specs)
    });
  }
  for (const child of suite.suites ?? []) {
    collectSuiteResults(child, writtenTests, fileResults, fallbackError);
  }
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
  return truncate2(firstNonEmpty(error.message, error.stack) ?? "Playwright test failed.");
}
function sumDurations(specs) {
  const duration = specs.flatMap((spec) => spec.tests ?? []).flatMap((testCase) => testCase.results ?? []).reduce((total, result) => total + (result.duration ?? 0), 0);
  return duration > 0 ? duration : null;
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
  return (0, import_node_path2.join)((0, import_node_path2.dirname)(runtimeRequire.resolve("playwright/package.json")), "cli.js");
}
function buildNodePath(existing) {
  const runtimeRequire = (0, import_node_module2.createRequire)(__filename);
  const dependencyPath = (0, import_node_path2.dirname)(
    (0, import_node_path2.dirname)((0, import_node_path2.dirname)(runtimeRequire.resolve("@playwright/test")))
  );
  return existing ? `${dependencyPath}${delimiter()}${existing}` : dependencyPath;
}
function getPlaywrightTestArgs(workDir, writtenTests) {
  return [
    getPlaywrightCliPath(),
    "test",
    "--config",
    (0, import_node_path2.join)(workDir, "playwright.config.cjs"),
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
  return lines.length > 0 ? truncate2(lines.join("\n")) : null;
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
  return errors.length > 0 ? truncate2(errors.join("\n\n")) : null;
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
  return new Promise((resolve) => {
    (0, import_node_child_process3.execFile)(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        const exitCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({
          exitCode,
          stdout,
          stderr
        });
      }
    );
  });
}
function safeFilePart(value) {
  return value.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 64) || "test";
}
function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return truncate2(trimmed);
    }
  }
  return null;
}
function truncate2(value, maxLength = 1e3) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
var import_node_child_process3, import_promises, import_node_os, import_node_path2, import_node_module2, PLAYWRIGHT_TYPE;
var init_playwright_runner = __esm({
  "src/playwright-runner.ts"() {
    "use strict";
    import_node_child_process3 = require("child_process");
    import_promises = require("fs/promises");
    import_node_os = require("os");
    import_node_path2 = require("path");
    init_playwright_install();
    import_node_module2 = require("module");
    PLAYWRIGHT_TYPE = "playwright";
  }
});

// src/agent-runner.ts
var agent_runner_exports = {};
__export(agent_runner_exports, {
  buildAgentWebSocketUrl: () => buildAgentWebSocketUrl,
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
  const socket = webSocketFactory(buildAgentWebSocketUrl(options.apiUrl, options.runId), {
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
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      fail(new CliError(`TestMutant agent generation timed out after ${options.timeoutMs} ms.`));
    }, options.timeoutMs);
    const finish = () => {
      if (settled || activeToolCalls > 0) {
        closeAfterToolCalls = true;
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve();
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.close();
      reject(error);
    };
    socket.on("open", () => {
      sendJson(socket, { type: "runner_ready" });
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
        clearTimeout(timeout);
        resolve();
        return;
      }
      closeAfterToolCalls = true;
      void reason;
    });
    async function handleMessage(data) {
      const message = parseAgentMessage(data);
      if (message.type === "agent_complete") {
        generationResult = {
          testId: typeof message.testId === "string" ? message.testId : null,
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
    testId: null,
    name: null,
    sourceLength: null,
    attemptCount: 0,
    validationSummary: null
  };
}
async function handleToolCall(socket, browserDriver, message) {
  if (!SUPPORTED_TOOLS.has(message.name)) {
    sendJson(socket, {
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
      sendJson(socket, {
        type: "tool_result",
        id: message.id,
        ok: false,
        error: extractObservationError(observation),
        observation: normalizeObservation(observation)
      });
      return;
    }
    sendJson(socket, {
      type: "tool_result",
      id: message.id,
      ok: true,
      observation: normalizeObservation(observation)
    });
  } catch (error) {
    sendJson(socket, {
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
  const browser = await import_playwright.chromium.launch({ headless: true });
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
                testId: "generated-draft",
                type: "playwright",
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
            tests: summary.tests,
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
      testId: typeof item.testId === "string" ? item.testId : "",
      type: typeof item.type === "string" ? item.type : "",
      name: typeof item.name === "string" ? item.name : "",
      status: item.status === "Passed" ? "Passed" : "Failed",
      errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : null,
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null
    }))
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
function sendJson(socket, value) {
  socket.send(JSON.stringify(value));
}
function formatApiError(message) {
  return typeof message === "string" && message.trim() ? message : "TestMutant agent generation failed.";
}
var import_playwright, import_ws, SUPPORTED_TOOLS;
var init_agent_runner = __esm({
  "src/agent-runner.ts"() {
    "use strict";
    import_playwright = require("playwright");
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
var import_config6 = require("dotenv/config");
var import_node_fs2 = require("fs");
var import_node_path3 = require("path");

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
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
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
      clearTimeout(timeout);
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
        return ` ${truncate(parts.join(" "), 500)}`;
      }
    } catch {
      return ` ${truncate(body, 500)}`;
    }
  }
  return ` ${truncate(body, 500)}`;
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
function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

// src/ci-metadata.ts
var import_node_child_process = require("child_process");
var import_node_fs = require("fs");
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
  return {
    mode: normalize(options.mode) ?? "Advisory",
    runKind: normalize(options.runKind) ?? "Advisory",
    repositoryProvider: repositoryProvider ?? "GitHub",
    repositoryFullName,
    baseUrl: normalizeUrl(options.baseUrl) ?? detectBaseUrl(env),
    environmentName: normalize(options.environmentName) ?? detectEnvironmentName(env),
    branch: detectBranch(env) ?? git(["rev-parse", "--abbrev-ref", "HEAD"]),
    commitSha: detectCommitSha(env) ?? git(["rev-parse", "HEAD"]),
    pullRequestNumber: detectPullRequestNumber(env),
    ciProvider: detectCiProvider(env),
    ciRunId: detectCiRunId(env)
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
  if (!eventPath || !(0, import_node_fs.existsSync)(eventPath)) {
    return null;
  }
  try {
    const event = JSON.parse((0, import_node_fs.readFileSync)(eventPath, "utf8"));
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
      (0, import_node_child_process.execFileSync)("git", ["-c", `safe.directory=${safeDirectory}`, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      })
    );
  } catch {
    return null;
  }
}

// src/run-ci.ts
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
    mode: options.mode,
    repositoryProvider: options.provider,
    repositoryFullName: options.repository,
    baseUrl: options.baseUrl,
    environmentName: options.environmentName
  });
  const created = await client.createRun(createRunRequest);
  const runTests = created.tests ?? [];
  const shouldGenerate = isGenerateMode(createRunRequest.mode);
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
      if (isEnforceMode(createRunRequest.mode)) {
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
    runTests,
    createRunRequest.baseUrl
  );
  const passed = testSummary.failed === 0;
  const completed = await client.completeRun(created.runId, {
    status: passed ? "Passed" : "Failed",
    summary: testSummary.total === 0 ? "CI metadata captured. No tests were returned for this run." : `Executed ${testSummary.total} Playwright test${testSummary.total === 1 ? "" : "s"}: ${testSummary.passed} passed, ${testSummary.failed} failed.`,
    results: {
      ...testSummary,
      repositoryFullName: createRunRequest.repositoryFullName,
      branch: createRunRequest.branch,
      commitSha: createRunRequest.commitSha,
      ciProvider: createRunRequest.ciProvider,
      ciRunId: createRunRequest.ciRunId,
      generatedAtUtc: (/* @__PURE__ */ new Date()).toISOString()
    },
    resultJson: null,
    errorMessage: passed ? null : `${testSummary.failed} Playwright test failed.`
  });
  if (!passed && isEnforceMode(createRunRequest.mode)) {
    throw new CliError(
      `TestMutant run failed: ${testSummary.failed} of ${testSummary.total} Playwright tests failed.`,
      1
    );
  }
  return {
    runId: completed.runId,
    status: completed.status,
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
function isGenerateMode(mode) {
  const normalized = mode?.trim().toLowerCase();
  return normalized === "generate" || normalized === "author";
}
async function getDefaultAgentGenerator() {
  const module2 = await Promise.resolve().then(() => (init_agent_runner(), agent_runner_exports));
  return module2.runAgentGeneration;
}
function isEnforceMode(mode) {
  return mode?.trim().toLowerCase() === "enforce";
}
async function executeTestsForApiCompletion(testExecutor, tests, baseUrl) {
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
        durationMs: null
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

// src/index.ts
var import_commander = require("commander");
init_config();
var packageInfo = readPackageInfo();
var program = new import_commander.Command();
program.name("testmutant").description("Run TestMutant workflows locally or in CI.").version(packageInfo.version).option("-k, --api-key <key>", `TestMutant API key. Defaults to ${API_KEY_ENV_VAR}.`).option(
  "-u, --api-url <url>",
  `TestMutant API base URL. Defaults to ${API_URL_ENV_VAR} or ${DEFAULT_API_URL}.`
).option("--timeout <ms>", "API request timeout in milliseconds.", "30000").option("--json", "Print command output as JSON.");
program.hook("preAction", async () => {
  const options = program.opts();
  if (options.json) {
    return;
  }
  await printUpdateReminder(packageInfo);
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
program.command("ci").description("Create and complete a TestMutant CI run.").argument("[url]", "Application base URL.").option("--mode <mode>", "Run mode.", "Advisory").option("--repository <repository>", "Repository full name override, e.g. owner/repo.").option("--provider <provider>", "Repository provider.", "GitHub").option("--base-url <url>", "Application base URL.").option("--environment <name>", "Environment name.").action(
  async (url, commandOptions) => {
    const options = program.opts();
    const result = await runCi({
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      timeout: options.timeout,
      mode: commandOptions.mode,
      repository: commandOptions.repository,
      provider: commandOptions.provider,
      baseUrl: url ?? commandOptions.baseUrl,
      environmentName: commandOptions.environment,
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
  const packageJsonPath = (0, import_node_path3.join)(__dirname, "..", "package.json");
  const packageJson = JSON.parse((0, import_node_fs2.readFileSync)(packageJsonPath, "utf8"));
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
  const timeout = setTimeout(() => controller.abort(), 1e3);
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
    clearTimeout(timeout);
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
