import { chromium, type Browser, type Page } from "playwright";
import { CliError } from "./config";
import { ensurePlaywrightBrowserInstalled } from "./playwright-install";
import WebSocket from "ws";
import { runPlaywrightTests, type TestRunSummary } from "./playwright-runner";
import type { CliRunTest } from "./api-client";

const SUPPORTED_TOOLS = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_evaluate",
  "playwright_validate_test",
]);

export type AgentRunnerOptions = {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
  userAgent: string;
  runId: string;
  baseUrl?: string | null;
  browserDriver?: BrowserDriver;
  webSocketFactory?: WebSocketFactory;
};

export type BrowserDriver = {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

export type WebSocketLike = {
  on(event: "open", listener: () => void): WebSocketLike;
  on(event: "message", listener: (data: unknown) => void): WebSocketLike;
  on(event: "error", listener: (error: Error) => void): WebSocketLike;
  on(event: "close", listener: (code?: number, reason?: unknown) => void): WebSocketLike;
  send(data: string): void;
  close(): void;
};

export type WebSocketFactory = (
  url: string,
  options: { headers: Record<string, string>; handshakeTimeout: number },
) => WebSocketLike;

type ToolCallMessage = {
  type: "tool_call";
  id: string;
  name: string;
  arguments?: unknown;
};

type AgentMessage =
  | ToolCallMessage
  | {
      type: "agent_complete";
      testId?: unknown;
      name?: unknown;
      sourceLength?: unknown;
      attemptCount?: unknown;
      validationSummary?: unknown;
    }
  | {
      type: "error";
      message?: unknown;
    };

export type AgentGenerationResult = {
  testId: string | null;
  name: string | null;
  sourceLength: number | null;
  attemptCount: number;
  validationSummary: TestRunSummary | null;
};

export function buildAgentWebSocketUrl(apiUrl: string, runId: string): string {
  const url = new URL(
    `/api/cli/v1/runs/${encodeURIComponent(runId)}/agent/ws`,
    apiUrl,
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

export async function runAgentGeneration(
  options: AgentRunnerOptions,
): Promise<AgentGenerationResult> {
  const browserDriver =
    options.browserDriver ?? (await createDirectPlaywrightDriver(options.baseUrl ?? null));

  try {
    return await runAgentWebSocketLoop(options, browserDriver);
  } finally {
    await browserDriver.close();
  }
}

async function runAgentWebSocketLoop(
  options: AgentRunnerOptions,
  browserDriver: BrowserDriver,
): Promise<AgentGenerationResult> {
  const webSocketFactory = options.webSocketFactory ?? createDefaultWebSocket;
  const socket = webSocketFactory(buildAgentWebSocketUrl(options.apiUrl, options.runId), {
    handshakeTimeout: options.timeoutMs,
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "user-agent": options.userAgent,
    },
  });

  let settled = false;
  let activeToolCalls = 0;
  let closeAfterToolCalls = false;
  let generationResult: AgentGenerationResult | null = null;

  await new Promise<void>((resolve, reject) => {
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

    const fail = (error: Error) => {
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

    async function handleMessage(data: unknown): Promise<void> {
      const message = parseAgentMessage(data);

      if (message.type === "agent_complete") {
        generationResult = {
          testId: typeof message.testId === "string" ? message.testId : null,
          name: typeof message.name === "string" ? message.name : null,
          sourceLength:
            typeof message.sourceLength === "number" ? message.sourceLength : null,
          attemptCount:
            typeof message.attemptCount === "number" ? message.attemptCount : 0,
          validationSummary: parseValidationSummary(message.validationSummary),
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

  return (
    generationResult ?? {
      testId: null,
      name: null,
      sourceLength: null,
      attemptCount: 0,
      validationSummary: null,
    }
  );
}

async function handleToolCall(
  socket: WebSocketLike,
  browserDriver: BrowserDriver,
  message: ToolCallMessage,
): Promise<void> {
  if (!SUPPORTED_TOOLS.has(message.name)) {
    sendJson(socket, {
      type: "tool_result",
      id: message.id,
      ok: false,
      error: `Unsupported browser tool: ${message.name}`,
      observation: {},
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
        observation: normalizeObservation(observation),
      });
      return;
    }

    sendJson(socket, {
      type: "tool_result",
      id: message.id,
      ok: true,
      observation: normalizeObservation(observation),
    });
  } catch (error) {
    sendJson(socket, {
      type: "tool_result",
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      observation: {},
    });
  }
}

async function createDirectPlaywrightDriver(
  baseUrl: string | null,
): Promise<BrowserDriver> {
  await ensurePlaywrightBrowserInstalled();

  const browser = await chromium.launch({ headless: true });
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
            result,
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
                source,
              } satisfies CliRunTest,
            ],
            { baseUrl },
          );
          return {
            passed: summary.failed === 0 && summary.total > 0,
            kind: summary.kind,
            summary: {
              total: summary.total,
              passed: summary.passed,
              failed: summary.failed,
              baseUrl: summary.baseUrl,
            },
            tests: summary.tests,
            failureExcerpt:
              summary.tests.find((test) => test.status === "Failed")?.errorMessage ?? null,
          };
        }

        default:
          throw new Error(`Unsupported browser tool: ${name}`);
      }
    },

    async close() {
      await browser.close();
    },
  };
}
async function snapshotPage(page: Page): Promise<unknown> {
  return {
    url: page.url(),
    title: await page.title(),
    text: await page.locator("body").innerText().catch(() => ""),
  };
}

function getRequiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Browser tool argument '${key}' is required.`);
  }

  return value;
}

function createDefaultWebSocket(
  url: string,
  options: { headers: Record<string, string>; handshakeTimeout: number },
): WebSocketLike {
  return new WebSocket(url, options);
}

function parseAgentMessage(data: unknown): AgentMessage {
  const raw =
    typeof data === "string" || Buffer.isBuffer(data)
      ? data.toString()
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString()
        : String(data);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("TestMutant agent sent invalid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new CliError("TestMutant agent sent an invalid message.");
  }

  const message = parsed as { type?: unknown };
  if (message.type === "tool_call") {
    const toolCall = parsed as Partial<ToolCallMessage>;
    if (
      typeof toolCall.id !== "string" ||
      typeof toolCall.name !== "string"
    ) {
      throw new CliError("TestMutant agent sent an invalid tool call.");
    }

    return {
      type: "tool_call",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    };
  }

  if (message.type === "agent_complete" || message.type === "error") {
    return parsed as AgentMessage;
  }

  throw new CliError("TestMutant agent sent an unsupported message.");
}

function parseValidationSummary(value: unknown): TestRunSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const summary = value as {
    kind?: unknown;
    baseUrl?: unknown;
    total?: unknown;
    passed?: unknown;
    failed?: unknown;
    tests?: unknown;
  };

  if (
    typeof summary.kind !== "string" ||
    typeof summary.total !== "number" ||
    typeof summary.passed !== "number" ||
    typeof summary.failed !== "number" ||
    !Array.isArray(summary.tests)
  ) {
    return null;
  }

  return {
    kind: "playwright",
    baseUrl: typeof summary.baseUrl === "string" ? summary.baseUrl : null,
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    tests: summary.tests
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        testId: typeof item.testId === "string" ? item.testId : "",
        type: typeof item.type === "string" ? item.type : "",
        name: typeof item.name === "string" ? item.name : "",
        status: item.status === "Passed" ? "Passed" : "Failed",
        errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : null,
        durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      })),
  };
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeObservation(value: unknown): unknown {
  if (value === undefined) {
    return {};
  }

  return JSON.parse(JSON.stringify(value));
}

function isToolErrorObservation(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "isError" in value &&
      (value as { isError?: unknown }).isError === true,
  );
}

function extractObservationError(value: unknown): string {
  if (!value || typeof value !== "object" || !("content" in value)) {
    return "Browser tool execution failed.";
  }

  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "Browser tool execution failed.";
  }

  const text = content
    .map((item) =>
      item &&
      typeof item === "object" &&
      "type" in item &&
      "text" in item &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text
        : null,
    )
    .filter((item): item is string => Boolean(item?.trim()))
    .join("\n");

  return text || "Browser tool execution failed.";
}

function sendJson(socket: WebSocketLike, value: unknown): void {
  socket.send(JSON.stringify(value));
}

function formatApiError(message: unknown): string {
  return typeof message === "string" && message.trim()
    ? message
    : "TestMutant agent generation failed.";
}
