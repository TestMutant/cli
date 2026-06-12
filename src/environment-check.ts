import { chromium } from "playwright";
import { ensurePlaywrightBrowserInstalled } from "./playwright-install";

/**
 * Environment check status values matching the API EnvironmentCheckStatus enum.
 */
export const EnvironmentCheckStatus = {
  Ready: 3,
  BaseUrlUnreachable: 4,
  LoginFailed: 5,
  Timeout: 6,
  NeedsConfiguration: 7,
} as const;

export type EnvironmentCheckStatusValue =
  (typeof EnvironmentCheckStatus)[keyof typeof EnvironmentCheckStatus];

/**
 * Auth mode values matching the API ProjectEnvironmentAuthMode enum.
 */
export const AuthMode = {
  None: 1,
  UsernamePassword: 2,
  CustomInstructions: 3,
} as const;

export type EnvironmentCheckContext = {
  baseUrl: string;
  authMode: number;
  loginUrl: string | null;
  loginInstructions: string | null;
  username: string | null;
  password: string | null;
  postLoginVerificationHint: string | null;
  timeoutMs: number;
};

export type EnvironmentCheckResult = {
  status: EnvironmentCheckStatusValue;
  statusReason: string | null;
  screenshotBuffer: Buffer | null;
};

export type EnvironmentCheckBrowserDriver = (
  context: EnvironmentCheckContext,
) => Promise<EnvironmentCheckResult>;

export type EnvironmentCheckOptions = {
  browserDriver?: EnvironmentCheckBrowserDriver;
};

/**
 * Executes an environment check against a project's configured base URL,
 * optionally verifying login page reachability, credential login, and
 * post-login verification hints.
 *
 * Returns a normalized status, human-readable reason, and an optional
 * screenshot buffer.
 */
export async function executeEnvironmentCheck(
  context: EnvironmentCheckContext,
  options: EnvironmentCheckOptions = {},
): Promise<EnvironmentCheckResult> {
  const configError = validateConfiguration(context);
  if (configError) {
    return configError;
  }

  const driver = options.browserDriver ?? playwrightBrowserDriver;

  try {
    const result = await driver(context);
    return {
      ...result,
      statusReason: result.statusReason
        ? redactSecrets(result.statusReason, context)
        : null,
    };
  } catch (error) {
    const isTimeout = isTimeoutError(error);
    return {
      status: isTimeout
        ? EnvironmentCheckStatus.Timeout
        : EnvironmentCheckStatus.BaseUrlUnreachable,
      statusReason: redactSecrets(extractErrorMessage(error), context),
      screenshotBuffer: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------

function validateConfiguration(
  context: EnvironmentCheckContext,
): EnvironmentCheckResult | null {
  if (!context.baseUrl) {
    return {
      status: EnvironmentCheckStatus.NeedsConfiguration,
      statusReason: "Base URL is required.",
      screenshotBuffer: null,
    };
  }

  try {
    const url = new URL(context.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        status: EnvironmentCheckStatus.NeedsConfiguration,
        statusReason: "Base URL must use http or https.",
        screenshotBuffer: null,
      };
    }
  } catch {
    return {
      status: EnvironmentCheckStatus.NeedsConfiguration,
      statusReason: "Base URL must be an absolute URL.",
      screenshotBuffer: null,
    };
  }

  if (context.loginUrl) {
    try {
      new URL(context.loginUrl);
    } catch {
      return {
        status: EnvironmentCheckStatus.NeedsConfiguration,
        statusReason: "Login URL must be an absolute URL.",
        screenshotBuffer: null,
      };
    }
  }

  if (
    context.authMode === AuthMode.UsernamePassword &&
    (!context.username || !context.password)
  ) {
    return {
      status: EnvironmentCheckStatus.NeedsConfiguration,
      statusReason:
        "Username/password authentication requires staging credentials.",
      screenshotBuffer: null,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Playwright browser driver (default implementation)
// ---------------------------------------------------------------------------

async function playwrightBrowserDriver(
  context: EnvironmentCheckContext,
): Promise<EnvironmentCheckResult> {
  await ensurePlaywrightBrowserInstalled();

  const startMs = Date.now();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    // Step 1: Check base URL reachability.
    const remaining1 = remainingMs(startMs, context.timeoutMs);
    if (remaining1 <= 0) {
      return timeoutResult("Environment check timed out before navigating to the base URL.");
    }

    try {
      const response = await page.goto(context.baseUrl, {
        waitUntil: "load",
        timeout: remaining1,
      });

      if (response && !isSuccessStatus(response.status())) {
        return {
          status: EnvironmentCheckStatus.BaseUrlUnreachable,
          statusReason: `Received HTTP ${response.status()} from ${hostOf(context.baseUrl)}.`,
          screenshotBuffer: await takeScreenshot(page),
        };
      }
    } catch (error) {
      return {
        status: isTimeoutError(error)
          ? EnvironmentCheckStatus.Timeout
          : EnvironmentCheckStatus.BaseUrlUnreachable,
        statusReason: extractErrorMessage(error),
        screenshotBuffer: await takeScreenshot(page),
      };
    }

    // If no login required and no login URL to verify, return Ready.
    if (context.authMode === AuthMode.None && !context.loginUrl) {
      return {
        status: EnvironmentCheckStatus.Ready,
        statusReason: "Base URL is reachable.",
        screenshotBuffer: await takeScreenshot(page),
      };
    }

    // Step 2: Check login page reachability (if explicit login URL provided).
    if (context.loginUrl) {
      const remaining2 = remainingMs(startMs, context.timeoutMs);
      if (remaining2 <= 0) {
        return timeoutResult("Environment check timed out before navigating to the login page.");
      }

      try {
        const response = await page.goto(context.loginUrl, {
          waitUntil: "load",
          timeout: remaining2,
        });

        if (response && !isSuccessStatus(response.status())) {
          return {
            status: EnvironmentCheckStatus.LoginFailed,
            statusReason: `Received HTTP ${response.status()} from login page.`,
            screenshotBuffer: await takeScreenshot(page),
          };
        }
      } catch (error) {
        return {
          status: isTimeoutError(error)
            ? EnvironmentCheckStatus.Timeout
            : EnvironmentCheckStatus.LoginFailed,
          statusReason: extractErrorMessage(error),
          screenshotBuffer: await takeScreenshot(page),
        };
      }
    }

    // Step 3: Perform credential login (if UsernamePassword mode).
    if (
      context.authMode === AuthMode.UsernamePassword &&
      context.username &&
      context.password
    ) {
      const loginError = await performCredentialLogin(page, context, startMs);
      if (loginError) {
        return loginError;
      }
    }

    // Step 4: Verify post-login hint (if provided).
    if (context.postLoginVerificationHint) {
      const hintError = await verifyPostLoginHint(page, context, startMs);
      if (hintError) {
        return hintError;
      }
    }

    // All checks passed.
    return {
      status: EnvironmentCheckStatus.Ready,
      statusReason: buildSuccessReason(context),
      screenshotBuffer: await takeScreenshot(page),
    };
  } finally {
    await browser.close();
  }
}

async function performCredentialLogin(
  page: import("playwright").Page,
  context: EnvironmentCheckContext,
  startMs: number,
): Promise<EnvironmentCheckResult | null> {
  const remaining = remainingMs(startMs, context.timeoutMs);
  if (remaining <= 0) {
    return timeoutResult("Environment check timed out before performing login.");
  }

  try {
    // Find username/email input field.
    const usernameInput = await findUsernameField(page, remaining);
    if (!usernameInput) {
      return {
        status: EnvironmentCheckStatus.LoginFailed,
        statusReason:
          "Could not find a username or email input field on the login page.",
        screenshotBuffer: await takeScreenshot(page),
      };
    }

    // Find password input field.
    const passwordInput = page.locator('input[type="password"]').first();
    const hasPassword = await passwordInput
      .waitFor({ state: "visible", timeout: Math.min(5000, remaining) })
      .then(() => true)
      .catch(() => false);

    if (!hasPassword) {
      return {
        status: EnvironmentCheckStatus.LoginFailed,
        statusReason:
          "Could not find a password input field on the login page.",
        screenshotBuffer: await takeScreenshot(page),
      };
    }

    // Fill credentials and submit.
    await usernameInput.fill(context.username!);
    await passwordInput.fill(context.password!);
    await passwordInput.press("Enter");

    // Wait for page to settle after form submission.
    const settleTimeout = Math.min(
      10_000,
      remainingMs(startMs, context.timeoutMs),
    );
    if (settleTimeout > 0) {
      await page
        .waitForLoadState("networkidle", { timeout: settleTimeout })
        .catch(() => {
          /* best-effort: page may keep making requests */
        });
    }
  } catch (error) {
    return {
      status: isTimeoutError(error)
        ? EnvironmentCheckStatus.Timeout
        : EnvironmentCheckStatus.LoginFailed,
      statusReason: extractErrorMessage(error),
      screenshotBuffer: await takeScreenshot(page),
    };
  }

  return null;
}

async function verifyPostLoginHint(
  page: import("playwright").Page,
  context: EnvironmentCheckContext,
  startMs: number,
): Promise<EnvironmentCheckResult | null> {
  const remaining = remainingMs(startMs, context.timeoutMs);
  if (remaining <= 0) {
    return timeoutResult(
      "Environment check timed out before verifying post-login hint.",
    );
  }

  const hint = context.postLoginVerificationHint!;

  try {
    await page
      .getByText(hint, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: remaining });
  } catch {
    return {
      status: EnvironmentCheckStatus.LoginFailed,
      statusReason: `Post-login verification failed: could not find "${truncate(hint, 100)}" on the page after login.`,
      screenshotBuffer: await takeScreenshot(page),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Field detection helpers
// ---------------------------------------------------------------------------

const USERNAME_SELECTORS = [
  'input[type="email"]:visible',
  'input[name="email"]:visible',
  'input[name="username"]:visible',
  'input[name="user"]:visible',
  'input[name="login"]:visible',
  'input[id="email"]:visible',
  'input[id="username"]:visible',
  'input[id="login"]:visible',
  'input[autocomplete="username"]:visible',
  'input[autocomplete="email"]:visible',
  'input[type="text"]:visible',
] as const;

async function findUsernameField(
  page: import("playwright").Page,
  timeoutMs: number,
): Promise<import("playwright").Locator | null> {
  const waitTimeout = Math.min(5000, timeoutMs);

  for (const selector of USERNAME_SELECTORS) {
    const locator = page.locator(selector).first();
    const found = await locator
      .waitFor({ state: "visible", timeout: waitTimeout })
      .then(() => true)
      .catch(() => false);

    if (found) {
      return locator;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

async function takeScreenshot(
  page: import("playwright").Page,
): Promise<Buffer | null> {
  try {
    return (await page.screenshot({ type: "png", fullPage: false })) as Buffer;
  } catch {
    return null;
  }
}

function timeoutResult(
  reason: string,
): EnvironmentCheckResult {
  return {
    status: EnvironmentCheckStatus.Timeout,
    statusReason: reason,
    screenshotBuffer: null,
  };
}

function remainingMs(startMs: number, totalMs: number): number {
  return Math.max(0, totalMs - (Date.now() - startMs));
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function buildSuccessReason(context: EnvironmentCheckContext): string {
  if (
    context.authMode === AuthMode.UsernamePassword &&
    context.username &&
    context.password
  ) {
    return context.postLoginVerificationHint
      ? "Base URL is reachable, login succeeded, and post-login verification passed."
      : "Base URL is reachable and login succeeded.";
  }

  if (context.loginUrl) {
    return context.authMode === AuthMode.CustomInstructions
      ? "Base URL and login page are reachable; custom login instructions are available to the hosted runner."
      : "Base URL and login page are reachable.";
  }

  return "Base URL is reachable.";
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") {
      return true;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") &&
      (message.includes("exceeded") ||
        message.includes("navigation") ||
        message.includes("waiting"))
    );
  }

  return false;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return truncate(error.message);
  }

  return truncate(String(error));
}

/**
 * Replaces occurrences of the username and password in a message
 * with [REDACTED] to prevent credential leakage in logs and API responses.
 */
export function redactSecrets(
  message: string,
  context: EnvironmentCheckContext,
): string {
  let result = message;
  const secrets = [context.username, context.password].filter(
    (value): value is string => Boolean(value && value.length > 0),
  );

  for (const secret of secrets) {
    result = replaceAll(result, secret, "[REDACTED]");
  }

  return result;
}

function replaceAll(input: string, search: string, replacement: string): string {
  if (!search) {
    return input;
  }

  let result = input;
  let index = result.indexOf(search);
  while (index !== -1) {
    result =
      result.slice(0, index) + replacement + result.slice(index + search.length);
    index = result.indexOf(search, index + replacement.length);
  }

  return result;
}

function truncate(value: string, maxLength = 1000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
