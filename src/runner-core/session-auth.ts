import type { Page } from "playwright";
import type {
  InternalRunnerEnvironmentPayload,
  RunnerSessionPreparationResponse,
} from "./runner-contracts";

const USERNAME_SELECTORS = [
  'input[type="email"]:visible',
  'input[name="email"]:visible',
  'input[name="username"]:visible',
  'input[autocomplete="username"]:visible',
  'input[type="text"]:visible',
] as const;

export async function prepareRunnerSession(
  page: Page,
  environment: InternalRunnerEnvironmentPayload | null | undefined,
  timeoutMs: number,
): Promise<RunnerSessionPreparationResponse> {
  if (!environment || environment.authMode === "none") {
    return ready(page);
  }

  if (environment.authMode === "custom_instructions") {
    if (requiresHumanOrSecret(environment.loginInstructions)) {
      return blocked(
        "Custom login instructions require a secret, MFA, or human action.",
        "unsupported_auth_flow",
        page,
      );
    }
    return ready(page, "Custom login instructions are available to the authoring worker.");
  }

  if (environment.authMode !== "username_password" || !environment.username || !environment.password) {
    return blocked("Runner login credentials are unavailable.", "missing_credentials", page);
  }

  try {
    await page.goto(environment.loginUrl ?? environment.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const username = await findUsernameInput(page, timeoutMs);
    const password = page.locator('input[type="password"]:visible').first();
    if (!username || !await password.isVisible({ timeout: Math.min(timeoutMs, 5_000) }).catch(() => false)) {
      return blocked("Runner could not find the configured login fields.", "login_fields_missing", page);
    }

    await username.fill(environment.username, { timeout: timeoutMs });
    await password.fill(environment.password, { timeout: timeoutMs });
    await password.press("Enter", { timeout: timeoutMs });
    await verify(page, environment, timeoutMs);
    return ready(page, "Runner login completed.");
  } catch (error) {
    return blocked("Runner login failed.", isTimeout(error) ? "auth_timeout" : "auth_failed", page);
  }
}

async function findUsernameInput(page: Page, timeoutMs: number) {
  for (const selector of USERNAME_SELECTORS) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: Math.min(timeoutMs, 2_000) }).catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function verify(
  page: Page,
  environment: InternalRunnerEnvironmentPayload,
  timeoutMs: number,
): Promise<void> {
  const verification = environment.postLoginVerification;
  if (!verification) {
    return;
  }

  if (verification.type === "url_contains") {
    await page.waitForURL(`**${verification.value}**`, { timeout: timeoutMs });
    return;
  }
  if (verification.type === "selector_exists") {
    await page.locator(verification.value).first().waitFor({ state: "visible", timeout: timeoutMs });
    return;
  }
  await page.getByText(verification.value, { exact: false }).first()
    .waitFor({ state: "visible", timeout: timeoutMs });
}

function ready(page: Page, summary = "Runner session is ready."): RunnerSessionPreparationResponse {
  return { status: "ready", summary, errorCode: null, url: page.url() };
}

function blocked(
  summary: string,
  errorCode: string,
  page: Page,
): RunnerSessionPreparationResponse {
  return { status: "blocked", summary, errorCode, url: page.url() };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || /timeout/i.test(error.message));
}

function requiresHumanOrSecret(instructions: string | null | undefined): boolean {
  return /\b(password|secret|token|api[ _-]?key|mfa|2fa|otp|one[- ]time|captcha|human|manually)\b/i
    .test(instructions ?? "");
}
