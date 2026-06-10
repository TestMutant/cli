import assert from "node:assert/strict";
import test from "node:test";
import { buildCreateRunRequest } from "../src/ci-metadata";

test("buildCreateRunRequest captures GitHub Actions metadata", () => {
  const env = withEnv({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "TestMutant/cli",
    GITHUB_HEAD_REF: "feature/tests",
    GITHUB_REF: "refs/pull/42/merge",
    GITHUB_REF_NAME: "42/merge",
    GITHUB_RUN_ID: "98765",
    GITHUB_SHA: "abc123",
    TESTMUTANT_BASE_URL: "preview.example.test",
    TESTMUTANT_ENVIRONMENT: "preview",
  });

  try {
    assert.deepEqual(
      buildCreateRunRequest({
        mode: "Advisory",
        runKind: "Advisory",
      }),
      {
        mode: "Advisory",
        runKind: "Advisory",
        repositoryProvider: "GitHub",
        repositoryFullName: "TestMutant/cli",
        baseUrl: "https://preview.example.test",
        environmentName: "preview",
        branch: "feature/tests",
        commitSha: "abc123",
        pullRequestNumber: 42,
        ciProvider: "GitHubActions",
        ciRunId: "98765",
      },
    );
  } finally {
    env.restore();
  }
});

test("buildCreateRunRequest lets explicit repository options override CI env", () => {
  const env = withEnv({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "TestMutant/cli",
    GITHUB_REF_NAME: "main",
    GITHUB_SHA: "abc123",
  });

  try {
    const request = buildCreateRunRequest({
      repositoryProvider: "GitLab",
      repositoryFullName: "example/project",
    });

    assert.equal(request.repositoryProvider, "GitLab");
    assert.equal(request.repositoryFullName, "example/project");
  } finally {
    env.restore();
  }
});

test("buildCreateRunRequest includes requirement and planned test ids when provided", () => {
  const env = withEnv({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "TestMutant/cli",
    GITHUB_REF_NAME: "main",
    GITHUB_SHA: "abc123",
  });

  try {
    const request = buildCreateRunRequest({
      requirementId: "11111111-1111-1111-1111-111111111111",
      plannedTestId: "22222222-2222-2222-2222-222222222222",
    });

    assert.equal(request.requirementId, "11111111-1111-1111-1111-111111111111");
    assert.equal(request.plannedTestId, "22222222-2222-2222-2222-222222222222");
  } finally {
    env.restore();
  }
});

function withEnv(values: Record<string, string | undefined>): {
  restore: () => void;
} {
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
