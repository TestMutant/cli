import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

export type RunnerServiceConfig = {
  host: string;
  port: number;
  token: string | null;
  runnerInstanceId: string;
  artifactDir: string;
  maxSessions: number;
  sessionTimeoutMs: number;
  headless: boolean;
  version: string;
};

export type RunnerServiceCliOptions = {
  host?: string;
  port?: string;
  token?: string;
  runnerInstanceId?: string;
  artifactDir?: string;
  maxSessions?: string;
  sessionTimeoutMs?: string;
  headless?: string;
};

export function resolveRunnerServiceConfig(
  options: RunnerServiceCliOptions,
  version: string,
): RunnerServiceConfig {
  return {
    host: options.host ?? process.env.TESTMUTANT_RUNNER_HOST ?? "0.0.0.0",
    port: parseIntOption(options.port ?? process.env.TESTMUTANT_RUNNER_PORT, 8080),
    token: nonEmpty(options.token ?? process.env.TESTMUTANT_RUNNER_TOKEN),
    runnerInstanceId:
      nonEmpty(options.runnerInstanceId ?? process.env.TESTMUTANT_RUNNER_INSTANCE_ID) ??
      stableLocalRunnerId(),
    artifactDir:
      nonEmpty(options.artifactDir ?? process.env.TESTMUTANT_RUNNER_ARTIFACT_DIR) ??
      join(tmpdir(), "testmutant-runner-artifacts"),
    maxSessions: parseIntOption(
      options.maxSessions ?? process.env.TESTMUTANT_RUNNER_MAX_SESSIONS,
      1,
    ),
    sessionTimeoutMs: parseIntOption(
      options.sessionTimeoutMs ?? process.env.TESTMUTANT_RUNNER_SESSION_TIMEOUT_MS,
      1_800_000,
    ),
    headless: parseBooleanOption(
      options.headless ?? process.env.TESTMUTANT_RUNNER_HEADLESS,
      true,
    ),
    version,
  };
}

function parseIntOption(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanOption(value: string | undefined, fallback: boolean): boolean {
  if (!value?.trim()) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(value.trim().toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value.trim().toLowerCase())) {
    return false;
  }

  return fallback;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function stableLocalRunnerId(): string {
  return `local-${randomUUID()}`;
}
