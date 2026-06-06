import assert from "node:assert/strict";
import test from "node:test";
import { TestMutantApiClient } from "../src/api-client";
import { CliError } from "../src/config";

test("ping posts the expected request and returns the response body", async () => {
  const fetchMock = new FetchMock(
    new Response(
      JSON.stringify({
        organizationId: "org_123",
        organizationName: "Acme",
        cliApiVersion: "1",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ),
  );

  await fetchMock.run(async () => {
    const client = new TestMutantApiClient({
      apiKey: "test-key",
      apiUrl: "https://api.example.test",
      timeoutMs: 30_000,
      userAgent: "testmutant-cli/test",
    });

    assert.deepEqual(await client.ping(), {
      organizationId: "org_123",
      organizationName: "Acme",
      cliApiVersion: "1",
    });
  });

  assert.equal(
    fetchMock.calls[0]?.url,
    "https://api.example.test/api/cli/v1/ping",
  );
  assert.equal(fetchMock.calls[0]?.init.method, "POST");
  assert.equal(fetchMock.calls[0]?.init.headers.authorization, "Bearer test-key");
  assert.equal(fetchMock.calls[0]?.init.headers["user-agent"], "testmutant-cli/test");
  assert.equal(
    fetchMock.calls[0]?.init.body,
    JSON.stringify({
      repositoryProvider: null,
      repositoryFullName: null,
    }),
  );
});

test("ping maps unauthorized responses to the CLI auth error", async () => {
  const fetchMock = new FetchMock(new Response("", { status: 401 }));

  await fetchMock.run(async () => {
    const client = new TestMutantApiClient({
      apiKey: "bad-key",
      apiUrl: "https://api.example.test",
      timeoutMs: 30_000,
      userAgent: "testmutant-cli/test",
    });

    await assert.rejects(
      () => client.ping(),
      (error: unknown) =>
        error instanceof CliError &&
        error.exitCode === 3 &&
        error.message === "Unauthorized. Check your TestMutant API key.",
    );
  });
});

type FetchCall = {
  url: string;
  init: {
    method?: string;
    body?: BodyInit | null;
    headers: Record<string, string>;
  };
};

class FetchMock {
  readonly calls: FetchCall[] = [];

  constructor(private readonly response: Response) {}

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
    const url =
      input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
    const headers = new Headers(init?.headers);

    this.calls.push({
      url,
      init: {
        method: init?.method,
        body: init?.body,
        headers: Object.fromEntries(headers.entries()),
      },
    });

    return this.response.clone();
  };
}
