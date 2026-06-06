import { TestMutantApiClient } from "./api-client";
import { buildCreateRunRequest } from "./ci-metadata";
import {
  API_KEY_ENV_VAR,
  API_URL_ENV_VAR,
  CliError,
  DEFAULT_API_URL,
  resolveConfig,
} from "./config";

export type RunCiOptions = {
  apiKey?: string;
  apiUrl?: string;
  timeout?: string;

  mode?: string;
  repository?: string;
  provider?: string;
  baseUrl?: string;
  environmentName?: string;

  userAgent: string;
};

export type RunCiResult = {
  runId: string;
  status: string;
};

export async function runCi(options: RunCiOptions): Promise<RunCiResult> {
  applyOptionEnvironmentOverrides(options);

  const config = resolveConfig({
    apiKey: options.apiKey,
    apiUrl: options.apiUrl,
    timeout: options.timeout,
  });

  const client = new TestMutantApiClient({
    ...config,
    userAgent: options.userAgent,
  });

  const createRunRequest = buildCreateRunRequest({
    mode: options.mode,
    repositoryProvider: options.provider,
    repositoryFullName: options.repository,
    baseUrl: options.baseUrl,
    environmentName: options.environmentName,
  });

  const created = await client.createRun(createRunRequest);

  const completed = await client.completeRun(created.runId, {
    status: "Passed",
    summary: "CI metadata captured.",
    results: {
      kind: "advisory",
      message: "TestMutant CLI vertical slice completed successfully.",
      repositoryFullName: createRunRequest.repositoryFullName,
      branch: createRunRequest.branch,
      commitSha: createRunRequest.commitSha,
      ciProvider: createRunRequest.ciProvider,
      ciRunId: createRunRequest.ciRunId,
      generatedAtUtc: new Date().toISOString(),
    },
    resultJson: null,
    errorMessage: null,
  });

  return {
    runId: completed.runId,
    status: completed.status,
  };
}

function applyOptionEnvironmentOverrides(options: RunCiOptions): void {
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
