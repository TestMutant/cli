export const DEFAULT_API_URL = "https://api.testmutant.com";
export const API_KEY_ENV_VAR = "TESTMUTANT_API_KEY";
export const API_URL_ENV_VAR = "TESTMUTANT_API_URL";

export type CliConfig = {
  apiKey: string;
  apiUrl: string;
  timeoutMs: number;
};

export type CliConfigInput = {
  apiKey?: string;
  apiUrl?: string;
  timeout?: string;
};

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function resolveConfig(input: CliConfigInput = {}): CliConfig {
  const apiKey = input.apiKey ?? process.env[API_KEY_ENV_VAR];
  const apiUrl = input.apiUrl ?? process.env[API_URL_ENV_VAR] ?? DEFAULT_API_URL;
  const timeoutMs = parseTimeout(input.timeout);

  if (!apiKey) {
    throw new CliError(
      `Missing API key. Set ${API_KEY_ENV_VAR} or pass --api-key.`,
      2,
    );
  }

  return {
    apiKey,
    apiUrl: normalizeApiUrl(apiUrl),
    timeoutMs,
  };
}

function normalizeApiUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new CliError(`Invalid API URL: ${value}`, 2);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("API URL must start with http:// or https://.", 2);
  }

  return url.toString().replace(/\/$/, "");
}

function parseTimeout(value?: string): number {
  if (!value) {
    return 30_000;
  }

  const timeoutMs = Number(value);

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliError("Timeout must be a positive integer in milliseconds.", 2);
  }

  return timeoutMs;
}
