import assert from "node:assert/strict";
import test from "node:test";
import { validateGeneratedPlaywrightSource } from "../src/runner-core/generated-source-policy";

const safeSource = `
import { test, expect } from "@playwright/test";
test("loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading")).toBeVisible();
});`;

test("generated Playwright source policy allows only a normal Playwright test", () => {
  assert.deepEqual(validateGeneratedPlaywrightSource(safeSource), { valid: true });
});

test("generated Playwright source policy rejects process access and protected values", () => {
  assert.equal(
    validateGeneratedPlaywrightSource(`${safeSource}\nconsole.log(process.env.SECRET);`).valid,
    false,
  );
  assert.equal(
    validateGeneratedPlaywrightSource(`${safeSource}\n// runner-password`, ["runner-password"]).valid,
    false,
  );
});

test("generated Playwright source policy rejects non-Playwright imports and browser context access", () => {
  assert.equal(
    validateGeneratedPlaywrightSource(
      `${safeSource}\nimport { readFile } from "node:fs/promises";`,
    ).valid,
    false,
  );
  assert.equal(
    validateGeneratedPlaywrightSource(`${safeSource}\npage.context();`).valid,
    false,
  );
  assert.equal(
    validateGeneratedPlaywrightSource(`${safeSource}\npage.request.get("https://outside.test");`).valid,
    false,
  );
});
