import assert from "node:assert/strict";
import test from "node:test";
import {
  API_KEY_ENV_VAR,
  API_URL_ENV_VAR,
  CliError,
  DEFAULT_API_URL,
  resolveConfig,
} from "../src/config";

test("resolveConfig uses explicit options first and normalizes the API URL", () => {
  const env = withEnv({
    [API_KEY_ENV_VAR]: "env-key",
    [API_URL_ENV_VAR]: "https://env.example.test/",
  });

  try {
    assert.deepEqual(
      resolveConfig({
        apiKey: "option-key",
        apiUrl: "https://api.example.test/",
        timeout: "1500",
      }),
      {
        apiKey: "option-key",
        apiUrl: "https://api.example.test",
        timeoutMs: 1500,
      },
    );
  } finally {
    env.restore();
  }
});

test("resolveConfig falls back to environment and default API URL", () => {
  const env = withEnv({
    [API_KEY_ENV_VAR]: "env-key",
    [API_URL_ENV_VAR]: undefined,
  });

  try {
    assert.deepEqual(resolveConfig(), {
      apiKey: "env-key",
      apiUrl: DEFAULT_API_URL,
      timeoutMs: 30_000,
    });
  } finally {
    env.restore();
  }
});

test("resolveConfig fails fast when the API key is missing", () => {
  const env = withEnv({
    [API_KEY_ENV_VAR]: undefined,
    [API_URL_ENV_VAR]: undefined,
  });

  try {
    assert.throws(
      () => resolveConfig(),
      (error: unknown) =>
        error instanceof CliError &&
        error.exitCode === 2 &&
        error.message ===
          "Missing API key. Set TESTMUTANT_API_KEY or pass --api-key.",
    );
  } finally {
    env.restore();
  }
});

test("resolveConfig rejects invalid timeout values", () => {
  assert.throws(
    () => resolveConfig({ apiKey: "key", timeout: "0" }),
    (error: unknown) =>
      error instanceof CliError &&
      error.exitCode === 2 &&
      error.message === "Timeout must be a positive integer in milliseconds.",
  );
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
