import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentWebSocketUrl,
  runAgentGeneration,
  type BrowserDriver,
  type WebSocketFactory,
  type WebSocketLike,
} from "../src/agent-runner";

test("buildAgentWebSocketUrl converts http API URLs to ws", () => {
  assert.equal(
    buildAgentWebSocketUrl(
      "http://api.example.test",
      "11111111-1111-1111-1111-111111111111",
    ),
    "ws://api.example.test/api/cli/v1/runs/11111111-1111-1111-1111-111111111111/agent/ws",
  );
});

test("buildAgentWebSocketUrl converts https API URLs to wss", () => {
  assert.equal(
    buildAgentWebSocketUrl(
      "https://api.example.test/base/",
      "11111111-1111-1111-1111-111111111111",
    ),
    "wss://api.example.test/api/cli/v1/runs/11111111-1111-1111-1111-111111111111/agent/ws",
  );
});

test("runAgentGeneration sends runner_ready immediately after connect", async () => {
  const harness = createHarness();
  const run = runAgentGeneration(harness.options());

  harness.socket.emitOpen();
  assert.deepEqual(harness.sentMessages(), [{ type: "runner_ready" }]);

  harness.socket.emitMessage({ type: "agent_complete" });
  assert.deepEqual(await run, {
    testImplementationId: null,
    name: null,
    sourceLength: null,
    attemptCount: 0,
    validationSummary: null,
  });
});

test("runAgentGeneration returns matching tool_result for a tool_call", async () => {
  const harness = createHarness({
    browserDriver: {
      async callTool(name, args) {
        assert.equal(name, "browser_snapshot");
        assert.deepEqual(args, { full: true });
        return { text: "snapshot" };
      },
      async close() {},
    },
  });
  const run = runAgentGeneration(harness.options());

  harness.socket.emitOpen();
  harness.socket.emitMessage({
    type: "tool_call",
    id: "call_123",
    name: "browser_snapshot",
    arguments: { full: true },
  });

  await waitFor(() => harness.sentMessages().length === 2);
  assert.deepEqual(harness.sentMessages()[1], {
    type: "tool_result",
    id: "call_123",
    ok: true,
    observation: { text: "snapshot" },
  });

  harness.socket.emitMessage({ type: "agent_complete" });
  await run;
});

test("runAgentGeneration rejects on API error messages", async () => {
  const harness = createHarness();
  const run = runAgentGeneration(harness.options());

  harness.socket.emitOpen();
  harness.socket.emitMessage({
    type: "error",
    message: "Agent failed to generate a test",
  });

  await assert.rejects(run, /Agent failed to generate a test/);
});

test("runAgentGeneration sends failed tool_result when local execution fails", async () => {
  const harness = createHarness({
    browserDriver: {
      async callTool() {
        throw new Error("Element reference expired");
      },
      async close() {},
    },
  });
  const run = runAgentGeneration(harness.options());

  harness.socket.emitOpen();
  harness.socket.emitMessage({
    type: "tool_call",
    id: "call_456",
    name: "browser_click",
    arguments: { ref: "e1" },
  });

  await waitFor(() => harness.sentMessages().length === 2);
  assert.deepEqual(harness.sentMessages()[1], {
    type: "tool_result",
    id: "call_456",
    ok: false,
    error: "Element reference expired",
    observation: {},
  });

  harness.socket.emitMessage({ type: "agent_complete" });
  await run;
});

test("runAgentGeneration executes playwright_validate_test locally", async () => {
  const harness = createHarness({
    browserDriver: {
      async callTool(name, args) {
        assert.equal(name, "playwright_validate_test");
        assert.equal(args.name, "Generated requirement test");
        return {
          passed: true,
          kind: "playwright",
          summary: {
            total: 1,
            passed: 1,
            failed: 0,
            baseUrl: "https://preview.example.test",
          },
          tests: [
            {
              implementationId: "generated-draft",
              runnerKind: "playwright",
              name: "Generated requirement test",
              status: "Passed",
              errorMessage: null,
              durationMs: 15,
            },
          ],
          failureExcerpt: null,
        };
      },
      async close() {},
    },
  });
  const run = runAgentGeneration(harness.options());

  harness.socket.emitOpen();
  harness.socket.emitMessage({
    type: "tool_call",
    id: "call_validate",
    name: "playwright_validate_test",
    arguments: {
      name: "Generated requirement test",
      source: "test source",
    },
  });

  await waitFor(() => harness.sentMessages().length === 2);
  assert.deepEqual(harness.sentMessages()[1], {
    type: "tool_result",
    id: "call_validate",
    ok: true,
    observation: {
      passed: true,
      kind: "playwright",
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        baseUrl: "https://preview.example.test",
      },
      tests: [
        {
          implementationId: "generated-draft",
          runnerKind: "playwright",
          name: "Generated requirement test",
          status: "Passed",
          errorMessage: null,
          durationMs: 15,
        },
      ],
      failureExcerpt: null,
    },
  });

  harness.socket.emitMessage({
    type: "agent_complete",
    testImplementationId: "11111111-1111-1111-1111-111111111111",
    name: "Generated requirement test",
    sourceLength: 123,
    attemptCount: 2,
    validationSummary: {
      kind: "playwright",
      baseUrl: "https://preview.example.test",
      total: 1,
      passed: 1,
      failed: 0,
      tests: [
        {
          implementationId: "generated-draft",
          runnerKind: "playwright",
          name: "Generated requirement test",
          status: "Passed",
          errorMessage: null,
          durationMs: 15,
        },
      ],
    },
  });

  assert.deepEqual(await run, {
    testImplementationId: "11111111-1111-1111-1111-111111111111",
    name: "Generated requirement test",
    sourceLength: 123,
    attemptCount: 2,
    validationSummary: {
      kind: "playwright",
      baseUrl: "https://preview.example.test",
      total: 1,
      passed: 1,
      failed: 0,
      tests: [
        {
          implementationId: "generated-draft",
          runnerKind: "playwright",
          name: "Generated requirement test",
          status: "Passed",
          errorMessage: null,
          durationMs: 15,
          screenshotBuffer: null,
        },
      ],
    },
  });
});

test("runAgentGeneration treats MCP error observations as failed tool results", async () => {
  const harness = createHarness({
    browserDriver: {
      async callTool() {
        return {
          isError: true,
          content: [{ type: "text", text: "MCP could not click the element" }],
        };
      },
      async close() {},
    },
  });
  const run = runAgentGeneration(harness.options());

  harness.socket.emitOpen();
  harness.socket.emitMessage({
    type: "tool_call",
    id: "call_789",
    name: "browser_click",
    arguments: { ref: "e1" },
  });

  await waitFor(() => harness.sentMessages().length === 2);
  assert.deepEqual(harness.sentMessages()[1], {
    type: "tool_result",
    id: "call_789",
    ok: false,
    error: "MCP could not click the element",
    observation: {
      isError: true,
      content: [{ type: "text", text: "MCP could not click the element" }],
    },
  });

  harness.socket.emitMessage({ type: "agent_complete" });
  await run;
});

function createHarness(options: { browserDriver?: BrowserDriver } = {}) {
  const socket = new FakeWebSocket();
  const browserDriver =
    options.browserDriver ??
    ({
      async callTool() {
        return {};
      },
      async close() {},
    } satisfies BrowserDriver);
  const webSocketFactory: WebSocketFactory = (url, wsOptions) => {
    assert.equal(
      url,
      "wss://api.example.test/api/cli/v1/runs/11111111-1111-1111-1111-111111111111/agent/ws",
    );
    assert.equal(wsOptions.headers.authorization, "Bearer test-key");
    assert.equal(wsOptions.headers["user-agent"], "testmutant-cli/test");
    assert.equal(wsOptions.handshakeTimeout, 30_000);
    return socket;
  };

  return {
    socket,
    options() {
      return {
        apiUrl: "https://api.example.test",
        apiKey: "test-key",
        timeoutMs: 30_000,
        userAgent: "testmutant-cli/test",
        runId: "11111111-1111-1111-1111-111111111111",
        browserDriver,
        webSocketFactory,
      };
    },
    sentMessages() {
      return socket.sent.map((message) => JSON.parse(message) as unknown);
    },
  };
}

class FakeWebSocket implements WebSocketLike {
  readonly sent: string[] = [];
  private readonly handlers = {
    open: [] as Array<() => void>,
    message: [] as Array<(data: unknown) => void>,
    error: [] as Array<(error: Error) => void>,
    close: [] as Array<(code?: number, reason?: unknown) => void>,
  };

  on(event: "open", listener: () => void): WebSocketLike;
  on(event: "message", listener: (data: unknown) => void): WebSocketLike;
  on(event: "error", listener: (error: Error) => void): WebSocketLike;
  on(
    event: "close",
    listener: (code?: number, reason?: unknown) => void,
  ): WebSocketLike;
  on(
    event: "open" | "message" | "error" | "close",
    listener:
      | (() => void)
      | ((data: unknown) => void)
      | ((error: Error) => void)
      | ((code?: number, reason?: unknown) => void),
  ): WebSocketLike {
    this.handlers[event].push(listener as never);
    return this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  emitOpen(): void {
    for (const handler of this.handlers.open) {
      handler();
    }
  }

  emitMessage(value: unknown): void {
    const data = typeof value === "string" ? value : JSON.stringify(value);
    for (const handler of this.handlers.message) {
      handler(data);
    }
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.ok(predicate());
}
