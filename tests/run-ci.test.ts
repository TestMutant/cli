import assert from "node:assert/strict";
import test from "node:test";
import { runCi } from "../src/run-ci";
import { API_KEY_ENV_VAR, API_URL_ENV_VAR, CliError } from "../src/config";
import type { TestRunSummary } from "../src/playwright-runner";

test("runCi completes the API run with executed test results", async () => {
  const env = withCiEnv();
  const fetchMock = new FetchQueue([
    jsonResponse(
      {
        runId: "11111111-1111-1111-1111-111111111111",
        organizationId: "22222222-2222-2222-2222-222222222222",
        projectId: "33333333-3333-3333-3333-333333333333",
        projectName: "Acme",
        repositoryId: "44444444-4444-4444-4444-444444444444",
        repositoryFullName: "TestMutant/cli",
        status: "Running",
        tests: [
          {
            testId: "55555555-5555-5555-5555-555555555555",
            type: "playwright",
            name: "loads home",
            source: "test source",
          },
        ],
      },
      201,
    ),
    jsonResponse({
      ok: true,
      runId: "11111111-1111-1111-1111-111111111111",
      status: "Passed",
    }),
  ]);

  try {
    await fetchMock.run(async () => {
      const result = await runCi({
        apiKey: "test-key",
        apiUrl: "https://api.example.test",
        baseUrl: "https://preview.example.test",
        mode: "Advisory",
        userAgent: "testmutant-cli/test",
        agentGenerator: async () => {},
        testExecutor: async (tests, options) => {
          assert.equal(tests.length, 1);
          assert.equal(options.baseUrl, "https://preview.example.test");
          return buildSummary({ failed: 0 });
        },
      });

      assert.deepEqual(result, {
        runId: "11111111-1111-1111-1111-111111111111",
        status: "Passed",
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        tests: [
          {
            testId: "55555555-5555-5555-5555-555555555555",
            type: "playwright",
            name: "loads home",
            status: "Passed",
            errorMessage: null,
            durationMs: 10,
          },
        ],
        baseUrl: "https://preview.example.test",
      });
    });
  } finally {
    env.restore();
  }

  assert.equal(fetchMock.calls.length, 2);
  assert.equal(
    fetchMock.calls[1]?.url,
    "https://api.example.test/api/cli/v1/runs/11111111-1111-1111-1111-111111111111/complete",
  );

  const completeBody = JSON.parse(fetchMock.calls[1]?.init.body ?? "{}") as {
    status?: string;
    results?: { failed?: number; repositoryFullName?: string };
  };
  assert.equal(completeBody.status, "Passed");
  assert.equal(completeBody.results?.failed, 0);
  assert.equal(completeBody.results?.repositoryFullName, "TestMutant/cli");
});

test("runCi completes failed results before enforcing nonzero failure", async () => {
  const env = withCiEnv();
  const fetchMock = new FetchQueue([
    jsonResponse(
      {
        runId: "11111111-1111-1111-1111-111111111111",
        organizationId: "22222222-2222-2222-2222-222222222222",
        projectId: "33333333-3333-3333-3333-333333333333",
        projectName: "Acme",
        repositoryId: "44444444-4444-4444-4444-444444444444",
        repositoryFullName: "TestMutant/cli",
        status: "Running",
        tests: [],
      },
      201,
    ),
    jsonResponse({
      ok: true,
      runId: "11111111-1111-1111-1111-111111111111",
      status: "Failed",
    }),
  ]);

  try {
    await fetchMock.run(async () => {
      await assert.rejects(
        () =>
          runCi({
            apiKey: "test-key",
            apiUrl: "https://api.example.test",
            mode: "Enforce",
            userAgent: "testmutant-cli/test",
            agentGenerator: async () => {},
            testExecutor: async () => buildSummary({ failed: 1 }),
          }),
        (error: unknown) =>
          error instanceof CliError &&
          error.message ===
            "TestMutant run failed: 1 of 1 Playwright tests failed.",
      );
    });
  } finally {
    env.restore();
  }

  assert.equal(fetchMock.calls.length, 2);
  const completeBody = JSON.parse(fetchMock.calls[1]?.init.body ?? "{}") as {
    status?: string;
    errorMessage?: string;
  };
  assert.equal(completeBody.status, "Failed");
  assert.equal(completeBody.errorMessage, "1 Playwright test failed.");
});

test("runCi reports runner errors to the API before returning", async () => {
  const env = withCiEnv();
  const fetchMock = new FetchQueue([
    jsonResponse(
      {
        runId: "11111111-1111-1111-1111-111111111111",
        organizationId: "22222222-2222-2222-2222-222222222222",
        projectId: "33333333-3333-3333-3333-333333333333",
        projectName: "Acme",
        repositoryId: "44444444-4444-4444-4444-444444444444",
        repositoryFullName: "TestMutant/cli",
        status: "Running",
        tests: [
          {
            testId: "55555555-5555-5555-5555-555555555555",
            type: "playwright",
            name: "loads home",
            source: "test source",
          },
        ],
      },
      201,
    ),
    jsonResponse({
      ok: true,
      runId: "11111111-1111-1111-1111-111111111111",
      status: "Failed",
    }),
  ]);

  try {
    await fetchMock.run(async () => {
      const result = await runCi({
        apiKey: "test-key",
        apiUrl: "https://api.example.test",
        mode: "Advisory",
        userAgent: "testmutant-cli/test",
        agentGenerator: async () => {},
        testExecutor: async () => {
          throw new Error("Playwright runtime is unavailable");
        },
      });

      assert.equal(result.status, "Failed");
      assert.equal(result.failedTests, 1);
    });
  } finally {
    env.restore();
  }

  const completeBody = JSON.parse(fetchMock.calls[1]?.init.body ?? "{}") as {
    results?: { tests?: Array<{ errorMessage?: string }> };
  };
  assert.equal(
    completeBody.results?.tests?.[0]?.errorMessage,
    "Playwright runtime is unavailable",
  );
});

function buildSummary(options: { failed: number }): TestRunSummary {
  const failed = options.failed;
  const passed = failed === 0 ? 1 : 0;

  return {
    kind: "playwright",
    baseUrl: "https://preview.example.test",
    total: 1,
    passed,
    failed,
    tests: [
      {
        testId: "55555555-5555-5555-5555-555555555555",
        type: "playwright",
        name: "loads home",
        status: failed === 0 ? "Passed" : "Failed",
        errorMessage: failed === 0 ? null : "Expected heading to be visible",
        durationMs: 10,
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = {
  url: string;
  init: {
    method?: string;
    body?: string;
    headers: Record<string, string>;
  };
};

class FetchQueue {
  readonly calls: FetchCall[] = [];

  constructor(private readonly responses: Response[]) {}

  async run(callback: () => Promise<void>): Promise<void> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = this.fetch;

    try {
      await callback();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  private readonly fetch: typeof globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const response = this.responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call.");
    }

    const url =
      input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
    const headers = new Headers(init?.headers);

    this.calls.push({
      url,
      init: {
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: Object.fromEntries(headers.entries()),
      },
    });

    return response.clone();
  };
}

function withCiEnv(): { restore: () => void } {
  const values: Record<string, string | undefined> = {
    [API_KEY_ENV_VAR]: undefined,
    [API_URL_ENV_VAR]: undefined,
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "TestMutant/cli",
    GITHUB_REF_NAME: "main",
    GITHUB_SHA: "abc123",
    GITHUB_RUN_ID: "98765",
  };
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return {
    restore() {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}
