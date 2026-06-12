import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runPlaywrightTests } from "../src/playwright-runner";
import type { CliRunImplementation } from "../src/api-client";

test("runPlaywrightTests maps Playwright JSON results by generated file", async () => {
  const cliTest = buildTest("11111111-1111-1111-1111-111111111111", "loads home");

  const summary = await runPlaywrightTests([cliTest], {
    baseUrl: "https://preview.example.test",
    commandRunner: async (_command, args, options) => {
      if (args.includes("install")) {
        assert.ok(args.includes("chromium"));
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const fileName = args.find((arg) => arg.endsWith(".spec.ts"));
      assert.ok(fileName);
      assert.ok(args.includes("test"));
      assert.ok(args.includes("--reporter=json"));
      assert.equal(await readFile(join(options.cwd, fileName), "utf8"), cliTest.source);

      const configPath = args[args.indexOf("--config") + 1];
      assert.ok(configPath);
      assert.match(
        await readFile(configPath, "utf8"),
        /baseURL: "https:\/\/preview\.example\.test"/,
      );

      return {
        exitCode: 0,
        stdout: JSON.stringify({
          suites: [
            {
              file: fileName,
              specs: [
                {
                  ok: true,
                  tests: [
                    {
                      ok: true,
                      results: [{ status: "passed", duration: 123 }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.deepEqual(summary, {
    kind: "playwright",
    baseUrl: "https://preview.example.test",
    total: 1,
    passed: 1,
    failed: 0,
    tests: [
      {
        implementationId: cliTest.implementationId,
        runnerKind: "playwright",
        name: "loads home",
        status: "Passed",
        errorMessage: null,
        durationMs: 123,
        screenshotBuffer: null,
        traceBuffer: null,
        videoBuffer: null,
      },
    ],
  });
});

test("runPlaywrightTests reports failures and unsupported test types", async () => {
  const passing = buildTest("11111111-1111-1111-1111-111111111111", "passes");
  const failing = buildTest("22222222-2222-2222-2222-222222222222", "fails");
  const unsupported = {
    implementationId: "33333333-3333-3333-3333-333333333333",
    testSpecId: "33333333-3333-3333-3333-333333333333",
    testLayer: "EndToEnd",
    runnerKind: "manual",
    name: "manual check",
    source: "",
  } satisfies CliRunImplementation;

  const summary = await runPlaywrightTests([passing, failing, unsupported], {
    commandRunner: async (_command, args) => {
      if (args.includes("install")) {
        assert.ok(args.includes("chromium"));
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const files = args.filter((arg) => arg.endsWith(".spec.ts"));

      return {
        exitCode: 1,
        stdout: JSON.stringify({
          suites: files.map((filePath) => ({
            file: filePath,
            specs: [
              {
                ok: !filePath.includes(failing.implementationId),
                tests: [
                  {
                    ok: !filePath.includes(failing.implementationId),
                    results: [
                      filePath.includes(failing.implementationId)
                        ? {
                            status: "failed",
                            duration: 45,
                            error: { message: "Expected heading to be visible" },
                          }
                        : { status: "passed", duration: 12 },
                    ],
                  },
                ],
              },
            ],
          })),
        }),
        stderr: "",
      };
    },
  });

  assert.equal(summary.total, 3);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 2);
  assert.equal(summary.tests[1]?.status, "Failed");
  assert.equal(summary.tests[1]?.errorMessage, "Expected heading to be visible");
  assert.equal(summary.tests[2]?.errorMessage, "Unsupported runner kind: manual");
});

test("runPlaywrightTests captures repair feedback when requested", async () => {
  const failing = buildTest("22222222-2222-2222-2222-222222222222", "fails");

  const summary = await runPlaywrightTests([failing], {
    captureRepairFeedback: true,
    commandRunner: async (_command, args) => {
      if (args.includes("install")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const fileName = args.find((arg) => arg.endsWith(".spec.ts"));

      return {
        exitCode: 1,
        stdout: JSON.stringify({
          suites: [
            {
              file: fileName,
              specs: [
                {
                  title: "fails",
                  ok: false,
                  tests: [
                    {
                      ok: false,
                      results: [
                        {
                          status: "failed",
                          duration: 45,
                          error: { message: "Expected heading to be visible" },
                          stdout: ["console.error: timeout"],
                          stderr: [{ text: "page crashed" }],
                          steps: [
                            { title: "goto /login" },
                            {
                              title: "expect heading to be visible",
                              error: { message: "Locator did not resolve" },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.deepEqual(summary.tests[0]?.repairFeedback, {
    consoleLogs: ["stdout: console.error: timeout", "stderr: page crashed"],
    browserObservations: [
      "Test: fails",
      "goto /login",
      "expect heading to be visible: Locator did not resolve",
    ],
  });
});

// ---------------------------------------------------------------------------
// CLI-03: Per-test timeout and trace/video in Playwright config
// ---------------------------------------------------------------------------

test("runPlaywrightTests uses perTestTimeoutMs in generated config", async () => {
  const cliTest = buildTest("11111111-1111-1111-1111-111111111111", "times out");

  let capturedConfig = "";

  await runPlaywrightTests([cliTest], {
    baseUrl: "https://example.test",
    perTestTimeoutMs: 45_000,
    commandRunner: async (_command, args, options) => {
      if (args.includes("install")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const configPath = args[args.indexOf("--config") + 1];
      assert.ok(configPath);
      capturedConfig = await readFile(configPath, "utf8");

      const fileName = args.find((arg) => arg.endsWith(".spec.ts"));
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          suites: [
            {
              file: fileName,
              specs: [{ ok: true, tests: [{ ok: true, results: [{ status: "passed", duration: 100 }] }] }],
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.match(capturedConfig, /timeout: 45000/);
});

test("runPlaywrightTests includes trace and video modes in generated config", async () => {
  const cliTest = buildTest("11111111-1111-1111-1111-111111111111", "traced");

  let capturedConfig = "";

  await runPlaywrightTests([cliTest], {
    baseUrl: "https://example.test",
    traceMode: "retain-on-failure",
    videoMode: "retain-on-failure",
    commandRunner: async (_command, args, options) => {
      if (args.includes("install")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const configPath = args[args.indexOf("--config") + 1];
      assert.ok(configPath);
      capturedConfig = await readFile(configPath, "utf8");

      const fileName = args.find((arg) => arg.endsWith(".spec.ts"));
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          suites: [
            {
              file: fileName,
              specs: [{ ok: true, tests: [{ ok: true, results: [{ status: "passed", duration: 50 }] }] }],
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.match(capturedConfig, /trace: 'retain-on-failure'/);
  assert.match(capturedConfig, /video: 'retain-on-failure'/);
});

test("runPlaywrightTests defaults trace and video to off", async () => {
  const cliTest = buildTest("11111111-1111-1111-1111-111111111111", "default");

  let capturedConfig = "";

  await runPlaywrightTests([cliTest], {
    baseUrl: "https://example.test",
    commandRunner: async (_command, args) => {
      if (args.includes("install")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const configPath = args[args.indexOf("--config") + 1];
      assert.ok(configPath);
      capturedConfig = await readFile(configPath, "utf8");

      const fileName = args.find((arg) => arg.endsWith(".spec.ts"));
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          suites: [
            {
              file: fileName,
              specs: [{ ok: true, tests: [{ ok: true, results: [{ status: "passed", duration: 50 }] }] }],
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.match(capturedConfig, /trace: 'off'/);
  assert.match(capturedConfig, /video: 'off'/);
});

test("runPlaywrightTests defaults timeout to 30000", async () => {
  const cliTest = buildTest("11111111-1111-1111-1111-111111111111", "default timeout");

  let capturedConfig = "";

  await runPlaywrightTests([cliTest], {
    baseUrl: "https://example.test",
    commandRunner: async (_command, args) => {
      if (args.includes("install")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const configPath = args[args.indexOf("--config") + 1];
      assert.ok(configPath);
      capturedConfig = await readFile(configPath, "utf8");

      const fileName = args.find((arg) => arg.endsWith(".spec.ts"));
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          suites: [
            {
              file: fileName,
              specs: [{ ok: true, tests: [{ ok: true, results: [{ status: "passed", duration: 50 }] }] }],
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.match(capturedConfig, /timeout: 30000/);
});

test("runPlaywrightTests workers is always 1", async () => {
  const cliTest = buildTest("11111111-1111-1111-1111-111111111111", "single worker");

  let capturedConfig = "";

  await runPlaywrightTests([cliTest], {
    baseUrl: "https://example.test",
    commandRunner: async (_command, args) => {
      if (args.includes("install")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const configPath = args[args.indexOf("--config") + 1];
      assert.ok(configPath);
      capturedConfig = await readFile(configPath, "utf8");

      const fileName = args.find((arg) => arg.endsWith(".spec.ts"));
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          suites: [
            {
              file: fileName,
              specs: [{ ok: true, tests: [{ ok: true, results: [{ status: "passed", duration: 50 }] }] }],
            },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.match(capturedConfig, /workers: 1/);
});

function buildTest(implementationId: string, name: string): CliRunImplementation {
  return {
    implementationId,
    testSpecId: implementationId,
    testLayer: "EndToEnd",
    runnerKind: "playwright",
    name,
    source: `import { test, expect } from "@playwright/test";\n\ntest(${JSON.stringify(
      name,
    )}, async ({ page }) => {\n  await page.goto("/");\n  await expect(page).toHaveTitle(/Example/);\n});\n`,
  };
}
