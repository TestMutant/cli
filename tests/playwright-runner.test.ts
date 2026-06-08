import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runPlaywrightTests } from "../src/playwright-runner";
import type { CliRunTest } from "../src/api-client";

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
        testId: cliTest.testId,
        type: "playwright",
        name: "loads home",
        status: "Passed",
        errorMessage: null,
        durationMs: 123,
      },
    ],
  });
});

test("runPlaywrightTests reports failures and unsupported test types", async () => {
  const passing = buildTest("11111111-1111-1111-1111-111111111111", "passes");
  const failing = buildTest("22222222-2222-2222-2222-222222222222", "fails");
  const unsupported = {
    testId: "33333333-3333-3333-3333-333333333333",
    type: "manual",
    name: "manual check",
    source: "",
  } satisfies CliRunTest;

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
                ok: !filePath.includes(failing.testId),
                tests: [
                  {
                    ok: !filePath.includes(failing.testId),
                    results: [
                      filePath.includes(failing.testId)
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
  assert.equal(summary.tests[2]?.errorMessage, "Unsupported test type: manual");
});

function buildTest(testId: string, name: string): CliRunTest {
  return {
    testId,
    type: "playwright",
    name,
    source: `import { test, expect } from "@playwright/test";\n\ntest(${JSON.stringify(
      name,
    )}, async ({ page }) => {\n  await page.goto("/");\n  await expect(page).toHaveTitle(/Example/);\n});\n`,
  };
}
