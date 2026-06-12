import assert from "node:assert/strict";
import test from "node:test";
import {
  isHostedRunnerMode,
  resolveHostedRunnerConfig,
  HOSTED_RUNNER_JOB_ID_ENV_VAR,
  ORGANIZATION_ID_ENV_VAR,
  PROJECT_ID_ENV_VAR,
  RUN_ID_ENV_VAR,
  RUNNER_SESSION_TOKEN_ENV_VAR,
  HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR,
  ENVIRONMENT_CONFIGURATION_ID_ENV_VAR,
  RUN_TIMEOUT_SECONDS_ENV_VAR,
  PER_TEST_TIMEOUT_SECONDS_ENV_VAR,
  MAX_TESTS_PER_RUN_ENV_VAR,
  MAX_ARTIFACT_SIZE_BYTES_ENV_VAR,
  MAX_REPAIR_ATTEMPTS_ENV_VAR,
} from "../src/hosted-runner-config";
import { API_URL_ENV_VAR, CliError } from "../src/config";

const VALID_PAYLOAD = {
  project: {
    organizationId: "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    organizationName: "Acme",
    projectId: "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    projectName: "WebApp",
    runId: "cccc0000-cccc-cccc-cccc-cccccccccccc",
    runKind: 0,
    repositoryFullName: null,
    baseUrl: "https://staging.example.test",
    environmentName: "Staging",
  },
  environment: null,
  testSource: {
    sourceKind: "Inline",
    tests: [
      {
        implementationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
        testSpecId: "eeee0000-eeee-eeee-eeee-eeeeeeeeeeee",
        requirementId: null,
        specTitle: "Login page loads",
        testLayer: "EndToEnd",
        runnerKind: "playwright",
        name: "login page loads",
        description: null,
        source: 'import { test } from "@playwright/test";\ntest("login", async ({ page }) => {});',
        targetPath: null,
        status: 0,
        lifecycleStatus: 0,
        implementationSource: 0,
      },
    ],
  },
  limits: {
    runTimeoutSeconds: 900,
    perTestTimeoutSeconds: 30,
    maxTestsPerRun: 10,
    maxArtifactSizeBytes: 10485760,
    maxRepairAttempts: 1,
  },
  artifactUploads: {
    maxArtifactSizeBytes: 10485760,
    callbackBasePath: "/api/cli/v1/hosted-runner/projects/bbbb0000/runs/cccc0000",
    heartbeatPath: "/api/cli/v1/hosted-runner/projects/bbbb0000/runs/cccc0000/heartbeat",
    screenshotPathTemplate: "/api/cli/v1/runs/cccc0000/results/{implementationId}/screenshot",
  },
};

function withHostedEnv(
  overrides: Record<string, string | undefined> = {},
): { restore: () => void } {
  const defaults: Record<string, string | undefined> = {
    [HOSTED_RUNNER_JOB_ID_ENV_VAR]: "11111111-1111-1111-1111-111111111111",
    [ORGANIZATION_ID_ENV_VAR]: "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    [PROJECT_ID_ENV_VAR]: "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    [RUN_ID_ENV_VAR]: "cccc0000-cccc-cccc-cccc-cccccccccccc",
    [RUNNER_SESSION_TOKEN_ENV_VAR]: "session-token-value",
    [HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]: JSON.stringify(VALID_PAYLOAD),
    [API_URL_ENV_VAR]: "https://api.example.test",
    [ENVIRONMENT_CONFIGURATION_ID_ENV_VAR]: undefined,
    [RUN_TIMEOUT_SECONDS_ENV_VAR]: undefined,
    [PER_TEST_TIMEOUT_SECONDS_ENV_VAR]: undefined,
    [MAX_TESTS_PER_RUN_ENV_VAR]: undefined,
    [MAX_ARTIFACT_SIZE_BYTES_ENV_VAR]: undefined,
    [MAX_REPAIR_ATTEMPTS_ENV_VAR]: undefined,
    ...overrides,
  };

  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(defaults)) {
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

test("isHostedRunnerMode returns true when payload and session token are set", () => {
  const env = withHostedEnv();
  try {
    assert.equal(isHostedRunnerMode(), true);
  } finally {
    env.restore();
  }
});

test("isHostedRunnerMode returns false when payload is missing", () => {
  const env = withHostedEnv({
    [HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]: undefined,
  });
  try {
    assert.equal(isHostedRunnerMode(), false);
  } finally {
    env.restore();
  }
});

test("isHostedRunnerMode returns false when session token is missing", () => {
  const env = withHostedEnv({
    [RUNNER_SESSION_TOKEN_ENV_VAR]: undefined,
  });
  try {
    assert.equal(isHostedRunnerMode(), false);
  } finally {
    env.restore();
  }
});

test("isHostedRunnerMode returns false when both are missing", () => {
  const env = withHostedEnv({
    [HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]: undefined,
    [RUNNER_SESSION_TOKEN_ENV_VAR]: undefined,
  });
  try {
    assert.equal(isHostedRunnerMode(), false);
  } finally {
    env.restore();
  }
});

test("isHostedRunnerMode returns false for whitespace-only values", () => {
  const env = withHostedEnv({
    [HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]: "   ",
    [RUNNER_SESSION_TOKEN_ENV_VAR]: "  ",
  });
  try {
    assert.equal(isHostedRunnerMode(), false);
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig parses all required fields from env vars", () => {
  const env = withHostedEnv();
  try {
    const config = resolveHostedRunnerConfig();
    assert.equal(config.hostedRunnerJobId, "11111111-1111-1111-1111-111111111111");
    assert.equal(config.organizationId, "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    assert.equal(config.projectId, "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    assert.equal(config.runId, "cccc0000-cccc-cccc-cccc-cccccccccccc");
    assert.equal(config.sessionToken, "session-token-value");
    assert.equal(config.apiUrl, "https://api.example.test");
    assert.equal(config.environmentConfigurationId, null);
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig parses payload with project context and test source", () => {
  const env = withHostedEnv();
  try {
    const config = resolveHostedRunnerConfig();
    assert.equal(config.payload.project.projectName, "WebApp");
    assert.equal(config.payload.project.baseUrl, "https://staging.example.test");
    assert.equal(config.payload.testSource.sourceKind, "Inline");
    assert.equal(config.payload.testSource.tests.length, 1);
    assert.equal(config.payload.testSource.tests[0]!.name, "login page loads");
    assert.equal(config.payload.testSource.tests[0]!.runnerKind, "playwright");
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig uses env var limits when provided", () => {
  const env = withHostedEnv({
    [RUN_TIMEOUT_SECONDS_ENV_VAR]: "600",
    [PER_TEST_TIMEOUT_SECONDS_ENV_VAR]: "45",
    [MAX_TESTS_PER_RUN_ENV_VAR]: "15",
    [MAX_ARTIFACT_SIZE_BYTES_ENV_VAR]: "5242880",
    [MAX_REPAIR_ATTEMPTS_ENV_VAR]: "3",
  });
  try {
    const config = resolveHostedRunnerConfig();
    assert.equal(config.limits.runTimeoutSeconds, 600);
    assert.equal(config.limits.perTestTimeoutSeconds, 45);
    assert.equal(config.limits.maxTestsPerRun, 15);
    assert.equal(config.limits.maxArtifactSizeBytes, 5242880);
    assert.equal(config.limits.maxRepairAttempts, 3);
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig uses default limits when env vars are absent", () => {
  const env = withHostedEnv();
  try {
    const config = resolveHostedRunnerConfig();
    assert.equal(config.limits.runTimeoutSeconds, 1800);
    assert.equal(config.limits.perTestTimeoutSeconds, 60);
    assert.equal(config.limits.maxTestsPerRun, 25);
    assert.equal(config.limits.maxArtifactSizeBytes, 50 * 1024 * 1024);
    assert.equal(config.limits.maxRepairAttempts, 2);
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig uses default limits for invalid numeric values", () => {
  const env = withHostedEnv({
    [RUN_TIMEOUT_SECONDS_ENV_VAR]: "not-a-number",
    [PER_TEST_TIMEOUT_SECONDS_ENV_VAR]: "-5",
    [MAX_TESTS_PER_RUN_ENV_VAR]: "0",
  });
  try {
    const config = resolveHostedRunnerConfig();
    assert.equal(config.limits.runTimeoutSeconds, 1800);
    assert.equal(config.limits.perTestTimeoutSeconds, 60);
    assert.equal(config.limits.maxTestsPerRun, 25);
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig reads optional environment configuration ID", () => {
  const env = withHostedEnv({
    [ENVIRONMENT_CONFIGURATION_ID_ENV_VAR]: "ffff0000-ffff-ffff-ffff-ffffffffffff",
  });
  try {
    const config = resolveHostedRunnerConfig();
    assert.equal(config.environmentConfigurationId, "ffff0000-ffff-ffff-ffff-ffffffffffff");
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig normalizes API URL trailing slash", () => {
  const env = withHostedEnv({
    [API_URL_ENV_VAR]: "https://api.example.test/",
  });
  try {
    const config = resolveHostedRunnerConfig();
    assert.equal(config.apiUrl, "https://api.example.test");
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig falls back to default API URL", () => {
  const env = withHostedEnv({
    [API_URL_ENV_VAR]: undefined,
  });
  try {
    const config = resolveHostedRunnerConfig();
    assert.equal(config.apiUrl, "https://api.testmutant.com");
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig throws when job ID is missing", () => {
  const env = withHostedEnv({
    [HOSTED_RUNNER_JOB_ID_ENV_VAR]: undefined,
  });
  try {
    assert.throws(
      () => resolveHostedRunnerConfig(),
      (error: unknown) =>
        error instanceof CliError &&
        error.exitCode === 2 &&
        error.message.includes(HOSTED_RUNNER_JOB_ID_ENV_VAR),
    );
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig throws when session token is missing", () => {
  const env = withHostedEnv({
    [RUNNER_SESSION_TOKEN_ENV_VAR]: undefined,
  });
  try {
    assert.throws(
      () => resolveHostedRunnerConfig(),
      (error: unknown) =>
        error instanceof CliError &&
        error.exitCode === 2 &&
        error.message.includes(RUNNER_SESSION_TOKEN_ENV_VAR),
    );
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig throws when payload JSON is missing", () => {
  const env = withHostedEnv({
    [HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]: undefined,
  });
  try {
    assert.throws(
      () => resolveHostedRunnerConfig(),
      (error: unknown) =>
        error instanceof CliError &&
        error.exitCode === 2 &&
        error.message.includes(HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR),
    );
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig throws when payload JSON is malformed", () => {
  const env = withHostedEnv({
    [HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]: "not valid json {{{",
  });
  try {
    assert.throws(
      () => resolveHostedRunnerConfig(),
      (error: unknown) =>
        error instanceof CliError &&
        error.exitCode === 2 &&
        error.message.includes("invalid JSON"),
    );
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig throws when payload JSON is missing project", () => {
  const env = withHostedEnv({
    [HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]: JSON.stringify({
      testSource: { sourceKind: "Inline", tests: [] },
      limits: { runTimeoutSeconds: 60 },
      artifactUploads: { maxArtifactSizeBytes: 100 },
    }),
  });
  try {
    assert.throws(
      () => resolveHostedRunnerConfig(),
      (error: unknown) =>
        error instanceof CliError &&
        error.exitCode === 2 &&
        error.message.includes("missing project"),
    );
  } finally {
    env.restore();
  }
});

test("resolveHostedRunnerConfig throws when payload JSON is missing testSource", () => {
  const env = withHostedEnv({
    [HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]: JSON.stringify({
      project: { projectId: "abc" },
      limits: { runTimeoutSeconds: 60 },
      artifactUploads: { maxArtifactSizeBytes: 100 },
    }),
  });
  try {
    assert.throws(
      () => resolveHostedRunnerConfig(),
      (error: unknown) =>
        error instanceof CliError &&
        error.exitCode === 2 &&
        error.message.includes("missing test source"),
    );
  } finally {
    env.restore();
  }
});
