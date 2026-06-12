import type { EnvironmentCheckConfig } from "./hosted-runner-config";
import {
  executeEnvironmentCheck,
  EnvironmentCheckStatus,
  type EnvironmentCheckBrowserDriver,
  type EnvironmentCheckResult,
} from "./environment-check";
import { HostedRunnerApiClient, type HostedRunnerArtifactUploadRequest } from "./api-client";

// TestArtifactKind.Screenshot = 0 (from API contract).
const SCREENSHOT_ARTIFACT_KIND = 0;

export type HostedEnvironmentCheckResult = {
  status: number;
  statusReason: string | null;
  artifactId: string | null;
};

export type HostedEnvironmentCheckArtifactUploader = (
  projectId: string,
  runId: string,
  request: HostedRunnerArtifactUploadRequest,
) => Promise<string | null>;

export type HostedEnvironmentCheckOptions = {
  browserDriver?: EnvironmentCheckBrowserDriver;
  artifactUploader?: HostedEnvironmentCheckArtifactUploader;
};

/**
 * Runs an environment check using the API-provided configuration,
 * uploads the resulting screenshot artifact, and returns a normalized
 * result suitable for the API to consume.
 */
export async function runHostedEnvironmentCheck(
  config: EnvironmentCheckConfig,
  options: HostedEnvironmentCheckOptions = {},
): Promise<HostedEnvironmentCheckResult> {
  const checkResult = await executeEnvironmentCheck(config.context, {
    browserDriver: options.browserDriver,
  });

  let artifactId: string | null = null;

  if (checkResult.screenshotBuffer) {
    const uploader = options.artifactUploader ?? createDefaultUploader(config);
    artifactId = await uploadScreenshot(
      uploader,
      config.projectId,
      config.runId,
      checkResult.screenshotBuffer,
    );
  }

  return {
    status: checkResult.status,
    statusReason: checkResult.statusReason,
    artifactId,
  };
}

async function uploadScreenshot(
  uploader: HostedEnvironmentCheckArtifactUploader,
  projectId: string,
  runId: string,
  screenshot: Buffer,
): Promise<string | null> {
  try {
    return await uploader(projectId, runId, {
      kind: SCREENSHOT_ARTIFACT_KIND,
      fileName: "environment-check-screenshot.png",
      contentType: "image/png",
      contentBase64: screenshot.toString("base64"),
    });
  } catch {
    // Best-effort: screenshot upload failure should not fail the check.
    return null;
  }
}

function createDefaultUploader(
  config: EnvironmentCheckConfig,
): HostedEnvironmentCheckArtifactUploader {
  const client = new HostedRunnerApiClient({
    apiUrl: config.apiUrl,
    sessionToken: config.sessionToken,
    timeoutMs: 30_000,
  });

  return async (projectId, runId, request) => {
    const response = await client.uploadArtifact(projectId, runId, request);
    return response.artifactId;
  };
}
