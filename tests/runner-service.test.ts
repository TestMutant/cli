import assert from "node:assert/strict";
import test from "node:test";
import { resolveRunnerServiceConfig } from "../src/runner-service/config";
import { startRunnerService } from "../src/runner-service/server";
import { ExecutionArtifactStore } from "../src/runner-service/execution-artifact-store";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("resolveRunnerServiceConfig uses env defaults and command overrides", () => {
  const oldPort = process.env.TESTMUTANT_RUNNER_PORT;
  const oldToken = process.env.TESTMUTANT_RUNNER_TOKEN;
  try {
    process.env.TESTMUTANT_RUNNER_PORT = "9090";
    process.env.TESTMUTANT_RUNNER_TOKEN = "env-token";

    const config = resolveRunnerServiceConfig(
      {
        port: "9091",
        token: "flag-token",
        maxSessions: "3",
        headless: "false",
      },
      "1.2.3",
    );

    assert.equal(config.port, 9091);
    assert.equal(config.token, "flag-token");
    assert.equal(config.maxSessions, 3);
    assert.equal(config.headless, false);
    assert.equal(config.version, "1.2.3");
  } finally {
    restoreEnv("TESTMUTANT_RUNNER_PORT", oldPort);
    restoreEnv("TESTMUTANT_RUNNER_TOKEN", oldToken);
  }
});

test("runner service health works without token when no token is configured", async () => {
  const service = await startRunnerService({
    host: "127.0.0.1",
    port: 0,
    token: null,
    runnerInstanceId: "runner-test",
    artifactDir: "C:\\tmp\\testmutant-runner-artifacts",
    maxSessions: 1,
    sessionTimeoutMs: 1000,
    headless: true,
    version: "test",
  });

  try {
    const response = await fetch(`${baseUrl(service.server)}/healthz`);
    const body = await response.json() as { capabilities?: string[] };

    assert.equal(response.status, 200);
    assert.ok(body.capabilities?.includes("browser.chromium"));
    assert.ok(body.capabilities?.includes("draft.validation"));
    assert.ok(body.capabilities?.includes("regression.execution.v1"));
    assert.ok(body.capabilities?.includes("artifact.download.v1"));
  } finally {
    await service.stop();
  }
});

test("execution artifact store replaces local paths with opaque handles and cleans up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "testmutant-artifacts-"));
  const path = join(directory, "failure.png");
  await writeFile(path, Buffer.from("png"));
  const store = new ExecutionArtifactStore();
  const summary = store.register("execution-1", directory, {
    kind: "playwright", baseUrl: "https://app.test", total: 1, passed: 0, failed: 1, skipped: 0, errored: 0,
    tests: [{ testId: "test-1", testSpecId: null, name: "Checkout", runnerKind: "playwright", status: "Failed", durationMs: 2,
      errorMessage: "Expected checkout", repairFeedback: null,
      artifacts: [{ kind: "screenshot", path, fileName: "failure.png", contentType: "image/png", sizeBytes: 3 }] }],
  });
  const artifact = summary.tests[0]!.artifacts[0]!;
  assert.equal(artifact.path, null);
  assert.ok(artifact.artifactId);
  assert.ok(store.open("execution-1", artifact.artifactId!));
  await store.cleanup("execution-1");
  assert.equal(store.open("execution-1", artifact.artifactId!), null);
});

test("runner service health requires bearer token when configured", async () => {
  const service = await startRunnerService({
    host: "127.0.0.1",
    port: 0,
    token: "secret-token",
    runnerInstanceId: "runner-test",
    artifactDir: "C:\\tmp\\testmutant-runner-artifacts",
    maxSessions: 1,
    sessionTimeoutMs: 1000,
    headless: true,
    version: "test",
  });

  try {
    const unauthorized = await fetch(`${baseUrl(service.server)}/healthz`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl(service.server)}/healthz`, {
      headers: { authorization: "Bearer secret-token" },
    });
    assert.equal(authorized.status, 200);
  } finally {
    await service.stop();
  }
});

function baseUrl(server: import("node:http").Server): string {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function restoreEnv(name: string, oldValue: string | undefined): void {
  if (oldValue === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = oldValue;
  }
}
