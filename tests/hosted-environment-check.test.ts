import assert from "node:assert/strict";
import test from "node:test";
import {
  runHostedEnvironmentCheck,
  type HostedEnvironmentCheckArtifactUploader,
} from "../src/hosted-environment-check";
import {
  EnvironmentCheckStatus,
  AuthMode,
  type EnvironmentCheckBrowserDriver,
} from "../src/environment-check";
import type { EnvironmentCheckConfig } from "../src/hosted-runner-config";
import type { HostedRunnerArtifactUploadRequest } from "../src/api-client";

function buildConfig(
  overrides: Partial<EnvironmentCheckConfig> = {},
): EnvironmentCheckConfig {
  return {
    hostedRunnerJobId: "11111111-1111-1111-1111-111111111111",
    organizationId: "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectId: "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    runId: "cccc0000-cccc-cccc-cccc-cccccccccccc",
    sessionToken: "session-token",
    apiUrl: "https://api.example.test",
    environmentConfigurationId: "dddd0000-dddd-dddd-dddd-dddddddddddd",
    environmentCheckId: "eeee0000-eeee-eeee-eeee-eeeeeeeeeeee",
    timeoutSeconds: 30,
    context: {
      baseUrl: "https://staging.example.test",
      authMode: AuthMode.None,
      loginUrl: null,
      loginInstructions: null,
      username: null,
      password: null,
      postLoginVerificationHint: null,
      timeoutMs: 30_000,
    },
    ...overrides,
  };
}

type UploadedArtifact = {
  projectId: string;
  runId: string;
  request: HostedRunnerArtifactUploadRequest;
};

function createMockUploader(): HostedEnvironmentCheckArtifactUploader & {
  uploads: UploadedArtifact[];
} {
  const uploads: UploadedArtifact[] = [];

  const uploader = async (
    projectId: string,
    runId: string,
    request: HostedRunnerArtifactUploadRequest,
  ): Promise<string | null> => {
    uploads.push({ projectId, runId, request });
    return "artifact-id-12345";
  };

  uploader.uploads = uploads;
  return uploader as HostedEnvironmentCheckArtifactUploader & {
    uploads: UploadedArtifact[];
  };
}

function successDriver(): EnvironmentCheckBrowserDriver {
  return async () => ({
    status: EnvironmentCheckStatus.Ready,
    statusReason: "Base URL is reachable.",
    screenshotBuffer: Buffer.from("fake-png-data"),
  });
}

// ---------------------------------------------------------------------------
// Success with artifact upload
// ---------------------------------------------------------------------------

test("runHostedEnvironmentCheck returns Ready and uploads screenshot", async () => {
  const config = buildConfig();
  const uploader = createMockUploader();

  const result = await runHostedEnvironmentCheck(config, {
    browserDriver: successDriver(),
    artifactUploader: uploader,
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.equal(result.statusReason, "Base URL is reachable.");
  assert.equal(result.artifactId, "artifact-id-12345");

  // Verify artifact was uploaded with correct parameters.
  assert.equal(uploader.uploads.length, 1);
  assert.equal(uploader.uploads[0]!.projectId, "bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  assert.equal(uploader.uploads[0]!.runId, "cccc0000-cccc-cccc-cccc-cccccccccccc");
  assert.equal(uploader.uploads[0]!.request.kind, 0); // Screenshot
  assert.equal(uploader.uploads[0]!.request.contentType, "image/png");
  assert.equal(
    uploader.uploads[0]!.request.fileName,
    "environment-check-screenshot.png",
  );
  assert.ok(uploader.uploads[0]!.request.contentBase64);
});

// ---------------------------------------------------------------------------
// Failure scenarios
// ---------------------------------------------------------------------------

test("runHostedEnvironmentCheck returns failure status from driver", async () => {
  const config = buildConfig();
  const uploader = createMockUploader();

  const result = await runHostedEnvironmentCheck(config, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.BaseUrlUnreachable,
      statusReason: "Received HTTP 503.",
      screenshotBuffer: Buffer.from("error-screenshot"),
    }),
    artifactUploader: uploader,
  });

  assert.equal(result.status, EnvironmentCheckStatus.BaseUrlUnreachable);
  assert.equal(result.statusReason, "Received HTTP 503.");
  assert.equal(result.artifactId, "artifact-id-12345");

  // Screenshot should still be uploaded on failure.
  assert.equal(uploader.uploads.length, 1);
});

test("runHostedEnvironmentCheck returns null artifactId when no screenshot", async () => {
  const config = buildConfig();
  const uploader = createMockUploader();

  const result = await runHostedEnvironmentCheck(config, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.Timeout,
      statusReason: "Timed out.",
      screenshotBuffer: null,
    }),
    artifactUploader: uploader,
  });

  assert.equal(result.status, EnvironmentCheckStatus.Timeout);
  assert.equal(result.artifactId, null);

  // No upload should be attempted when there's no screenshot.
  assert.equal(uploader.uploads.length, 0);
});

// ---------------------------------------------------------------------------
// Upload failure handling
// ---------------------------------------------------------------------------

test("runHostedEnvironmentCheck returns null artifactId when upload fails", async () => {
  const config = buildConfig();

  const failingUploader: HostedEnvironmentCheckArtifactUploader = async () => {
    throw new Error("Network error");
  };

  const result = await runHostedEnvironmentCheck(config, {
    browserDriver: successDriver(),
    artifactUploader: failingUploader,
  });

  // The check should still succeed; artifact upload is best-effort.
  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.equal(result.artifactId, null);
});

// ---------------------------------------------------------------------------
// Config validation pass-through
// ---------------------------------------------------------------------------

test("runHostedEnvironmentCheck returns NeedsConfiguration for invalid context", async () => {
  const config = buildConfig({
    context: {
      baseUrl: "",
      authMode: AuthMode.None,
      loginUrl: null,
      loginInstructions: null,
      username: null,
      password: null,
      postLoginVerificationHint: null,
      timeoutMs: 30_000,
    },
  });
  const uploader = createMockUploader();

  const result = await runHostedEnvironmentCheck(config, {
    browserDriver: async () => {
      throw new Error("should not be called");
    },
    artifactUploader: uploader,
  });

  assert.equal(result.status, EnvironmentCheckStatus.NeedsConfiguration);
  assert.equal(result.artifactId, null);
  assert.equal(uploader.uploads.length, 0);
});

// ---------------------------------------------------------------------------
// Login check integration
// ---------------------------------------------------------------------------

test("runHostedEnvironmentCheck with UsernamePassword uploads post-login screenshot", async () => {
  const config = buildConfig({
    context: {
      baseUrl: "https://staging.example.test",
      authMode: AuthMode.UsernamePassword,
      loginUrl: "https://staging.example.test/login",
      loginInstructions: null,
      username: "admin",
      password: "secret",
      postLoginVerificationHint: "Dashboard",
      timeoutMs: 30_000,
    },
  });
  const uploader = createMockUploader();

  const result = await runHostedEnvironmentCheck(config, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.Ready,
      statusReason:
        "Base URL is reachable, login succeeded, and post-login verification passed.",
      screenshotBuffer: Buffer.from("dashboard-screenshot"),
    }),
    artifactUploader: uploader,
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.ok(result.statusReason!.includes("login succeeded"));
  assert.equal(result.artifactId, "artifact-id-12345");
  assert.equal(uploader.uploads.length, 1);

  // Verify the screenshot content is the base64 of the buffer.
  const expectedBase64 = Buffer.from("dashboard-screenshot").toString("base64");
  assert.equal(uploader.uploads[0]!.request.contentBase64, expectedBase64);
});
