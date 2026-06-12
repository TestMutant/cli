import type { components } from "./generated/api";
import { API_URL_ENV_VAR, CliError, DEFAULT_API_URL } from "./config";

export type HostedRunnerPayload = components["schemas"]["HostedRunnerPayload"];
export type HostedRunnerProjectContext = components["schemas"]["HostedRunnerProjectContext"];
export type HostedRunnerEnvironmentContext = components["schemas"]["HostedRunnerEnvironmentContext"];
export type HostedRunnerTestSource = components["schemas"]["HostedRunnerTestSource"];
export type HostedRunnerTestDefinition = components["schemas"]["HostedRunnerTestDefinition"];
export type HostedRunnerLimits = components["schemas"]["HostedRunnerLimits"];
export type HostedRunnerArtifactUploadInstructions =
  components["schemas"]["HostedRunnerArtifactUploadInstructions"];

export const HOSTED_RUNNER_JOB_ID_ENV_VAR = "TESTMUTANT_HOSTED_RUNNER_JOB_ID";
export const ORGANIZATION_ID_ENV_VAR = "TESTMUTANT_ORGANIZATION_ID";
export const PROJECT_ID_ENV_VAR = "TESTMUTANT_PROJECT_ID";
export const RUN_ID_ENV_VAR = "TESTMUTANT_RUN_ID";
export const RUNNER_SESSION_TOKEN_ENV_VAR = "TESTMUTANT_RUNNER_SESSION_TOKEN";
export const HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR = "TESTMUTANT_HOSTED_RUNNER_PAYLOAD_JSON";
export const ENVIRONMENT_CONFIGURATION_ID_ENV_VAR = "TESTMUTANT_ENVIRONMENT_CONFIGURATION_ID";
export const RUN_TIMEOUT_SECONDS_ENV_VAR = "TESTMUTANT_RUN_TIMEOUT_SECONDS";
export const PER_TEST_TIMEOUT_SECONDS_ENV_VAR = "TESTMUTANT_PER_TEST_TIMEOUT_SECONDS";
export const MAX_TESTS_PER_RUN_ENV_VAR = "TESTMUTANT_MAX_TESTS_PER_RUN";
export const MAX_ARTIFACT_SIZE_BYTES_ENV_VAR = "TESTMUTANT_MAX_ARTIFACT_SIZE_BYTES";
export const MAX_REPAIR_ATTEMPTS_ENV_VAR = "TESTMUTANT_MAX_REPAIR_ATTEMPTS";

export type HostedRunnerConfig = {
  hostedRunnerJobId: string;
  organizationId: string;
  projectId: string;
  runId: string;
  sessionToken: string;
  apiUrl: string;
  environmentConfigurationId: string | null;
  payload: HostedRunnerPayload;
  limits: {
    runTimeoutSeconds: number;
    perTestTimeoutSeconds: number;
    maxTestsPerRun: number;
    maxArtifactSizeBytes: number;
    maxRepairAttempts: number;
  };
};

/**
 * Returns true when the process was launched by the API as a hosted runner.
 * Detected by the presence of the payload JSON and session token env vars
 * that the API's ExternalHostedRunnerProcessStarter sets.
 */
export function isHostedRunnerMode(): boolean {
  return Boolean(
    process.env[HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR]?.trim() &&
      process.env[RUNNER_SESSION_TOKEN_ENV_VAR]?.trim(),
  );
}

/**
 * Parses the full hosted runner configuration from environment variables
 * set by the API's ExternalHostedRunnerProcessStarter.
 *
 * Throws CliError if any required variable is missing or the payload JSON
 * is malformed.
 */
export function resolveHostedRunnerConfig(): HostedRunnerConfig {
  const hostedRunnerJobId = requireEnv(HOSTED_RUNNER_JOB_ID_ENV_VAR);
  const organizationId = requireEnv(ORGANIZATION_ID_ENV_VAR);
  const projectId = requireEnv(PROJECT_ID_ENV_VAR);
  const runId = requireEnv(RUN_ID_ENV_VAR);
  const sessionToken = requireEnv(RUNNER_SESSION_TOKEN_ENV_VAR);
  const payloadJson = requireEnv(HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR);
  const apiUrl =
    process.env[API_URL_ENV_VAR]?.trim() || DEFAULT_API_URL;
  const environmentConfigurationId =
    process.env[ENVIRONMENT_CONFIGURATION_ID_ENV_VAR]?.trim() || null;

  const payload = parsePayloadJson(payloadJson);

  return {
    hostedRunnerJobId,
    organizationId,
    projectId,
    runId,
    sessionToken,
    apiUrl: normalizeUrl(apiUrl),
    environmentConfigurationId,
    payload,
    limits: {
      runTimeoutSeconds: parsePositiveInt(RUN_TIMEOUT_SECONDS_ENV_VAR, 1800),
      perTestTimeoutSeconds: parsePositiveInt(PER_TEST_TIMEOUT_SECONDS_ENV_VAR, 60),
      maxTestsPerRun: parsePositiveInt(MAX_TESTS_PER_RUN_ENV_VAR, 25),
      maxArtifactSizeBytes: parsePositiveInt(MAX_ARTIFACT_SIZE_BYTES_ENV_VAR, 50 * 1024 * 1024),
      maxRepairAttempts: parsePositiveInt(MAX_REPAIR_ATTEMPTS_ENV_VAR, 2),
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CliError(
      `Hosted runner mode requires ${name} to be set.`,
      2,
    );
  }
  return value;
}

function parsePositiveInt(envVar: string, defaultValue: number): number {
  const raw = process.env[envVar]?.trim();
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parsePayloadJson(json: string): HostedRunnerPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: invalid JSON.`,
      2,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: expected a JSON object.`,
      2,
    );
  }

  const payload = parsed as Record<string, unknown>;

  if (!payload.project || typeof payload.project !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: missing project context.`,
      2,
    );
  }

  if (!payload.testSource || typeof payload.testSource !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: missing test source.`,
      2,
    );
  }

  if (!payload.limits || typeof payload.limits !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: missing limits.`,
      2,
    );
  }

  if (!payload.artifactUploads || typeof payload.artifactUploads !== "object") {
    throw new CliError(
      `Failed to parse ${HOSTED_RUNNER_PAYLOAD_JSON_ENV_VAR}: missing artifact upload instructions.`,
      2,
    );
  }

  return parsed as HostedRunnerPayload;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/$/, "");
}
