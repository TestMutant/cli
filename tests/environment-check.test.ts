import assert from "node:assert/strict";
import test from "node:test";
import {
  executeEnvironmentCheck,
  EnvironmentCheckStatus,
  AuthMode,
  redactSecrets,
  type EnvironmentCheckContext,
  type EnvironmentCheckResult,
  type EnvironmentCheckBrowserDriver,
} from "../src/environment-check";

function buildContext(
  overrides: Partial<EnvironmentCheckContext> = {},
): EnvironmentCheckContext {
  return {
    baseUrl: "https://staging.example.test",
    authMode: AuthMode.None,
    loginUrl: null,
    loginInstructions: null,
    username: null,
    password: null,
    postLoginVerificationHint: null,
    timeoutMs: 30_000,
    ...overrides,
  };
}

function successDriver(
  overrides: Partial<EnvironmentCheckResult> = {},
): EnvironmentCheckBrowserDriver {
  return async () => ({
    status: EnvironmentCheckStatus.Ready,
    statusReason: "Base URL is reachable.",
    screenshotBuffer: Buffer.from("fake-screenshot-png"),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------

test("executeEnvironmentCheck returns NeedsConfiguration when base URL is empty", async () => {
  const context = buildContext({ baseUrl: "" });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver(),
  });

  assert.equal(result.status, EnvironmentCheckStatus.NeedsConfiguration);
  assert.equal(result.statusReason, "Base URL is required.");
  assert.equal(result.screenshotBuffer, null);
});

test("executeEnvironmentCheck returns NeedsConfiguration when base URL is not absolute", async () => {
  const context = buildContext({ baseUrl: "not-a-url" });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver(),
  });

  assert.equal(result.status, EnvironmentCheckStatus.NeedsConfiguration);
  assert.equal(result.statusReason, "Base URL must be an absolute URL.");
});

test("executeEnvironmentCheck returns NeedsConfiguration when base URL uses non-http protocol", async () => {
  const context = buildContext({ baseUrl: "ftp://staging.example.test" });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver(),
  });

  assert.equal(result.status, EnvironmentCheckStatus.NeedsConfiguration);
  assert.equal(result.statusReason, "Base URL must use http or https.");
});

test("executeEnvironmentCheck returns NeedsConfiguration when login URL is not absolute", async () => {
  const context = buildContext({ loginUrl: "relative/path" });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver(),
  });

  assert.equal(result.status, EnvironmentCheckStatus.NeedsConfiguration);
  assert.equal(result.statusReason, "Login URL must be an absolute URL.");
});

test("executeEnvironmentCheck returns NeedsConfiguration when UsernamePassword mode lacks credentials", async () => {
  const context = buildContext({
    authMode: AuthMode.UsernamePassword,
    username: null,
    password: null,
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver(),
  });

  assert.equal(result.status, EnvironmentCheckStatus.NeedsConfiguration);
  assert.ok(result.statusReason!.includes("credentials"));
});

test("executeEnvironmentCheck returns NeedsConfiguration when UsernamePassword has username but no password", async () => {
  const context = buildContext({
    authMode: AuthMode.UsernamePassword,
    username: "admin",
    password: null,
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver(),
  });

  assert.equal(result.status, EnvironmentCheckStatus.NeedsConfiguration);
});

// ---------------------------------------------------------------------------
// Successful checks
// ---------------------------------------------------------------------------

test("executeEnvironmentCheck returns Ready for reachable base URL with no auth", async () => {
  const context = buildContext();

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver(),
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.equal(result.statusReason, "Base URL is reachable.");
  assert.ok(result.screenshotBuffer);
});

test("executeEnvironmentCheck returns Ready with login URL success", async () => {
  const context = buildContext({
    loginUrl: "https://staging.example.test/login",
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver({
      statusReason: "Base URL and login page are reachable.",
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.ok(result.statusReason!.includes("login page"));
});

test("executeEnvironmentCheck returns Ready with successful credential login", async () => {
  const context = buildContext({
    authMode: AuthMode.UsernamePassword,
    loginUrl: "https://staging.example.test/login",
    username: "admin@example.test",
    password: "s3cret!",
  });

  let driverContext: EnvironmentCheckContext | null = null;
  const driver: EnvironmentCheckBrowserDriver = async (ctx) => {
    driverContext = ctx;
    return {
      status: EnvironmentCheckStatus.Ready,
      statusReason: "Base URL is reachable and login succeeded.",
      screenshotBuffer: Buffer.from("post-login-screenshot"),
    };
  };

  const result = await executeEnvironmentCheck(context, {
    browserDriver: driver,
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.ok(result.statusReason!.includes("login succeeded"));
  assert.ok(result.screenshotBuffer);

  // Verify the driver received the full context including credentials.
  assert.equal(driverContext!.username, "admin@example.test");
  assert.equal(driverContext!.password, "s3cret!");
  assert.equal(driverContext!.loginUrl, "https://staging.example.test/login");
});

test("executeEnvironmentCheck returns Ready with post-login hint verified", async () => {
  const context = buildContext({
    authMode: AuthMode.UsernamePassword,
    loginUrl: "https://staging.example.test/login",
    username: "admin",
    password: "password",
    postLoginVerificationHint: "Dashboard",
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver({
      statusReason:
        "Base URL is reachable, login succeeded, and post-login verification passed.",
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.ok(result.statusReason!.includes("post-login verification passed"));
});

test("executeEnvironmentCheck returns Ready for CustomInstructions with login URL", async () => {
  const context = buildContext({
    authMode: AuthMode.CustomInstructions,
    loginUrl: "https://staging.example.test/login",
    loginInstructions: "Click SSO button and enter credentials",
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver({
      statusReason:
        "Base URL and login page are reachable; custom login instructions are available to the hosted runner.",
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.ok(result.statusReason!.includes("custom login instructions"));
});

// ---------------------------------------------------------------------------
// Failure scenarios
// ---------------------------------------------------------------------------

test("executeEnvironmentCheck returns BaseUrlUnreachable from driver", async () => {
  const context = buildContext();

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.BaseUrlUnreachable,
      statusReason: "Received HTTP 503 from staging.example.test.",
      screenshotBuffer: Buffer.from("error-screenshot"),
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.BaseUrlUnreachable);
  assert.ok(result.statusReason!.includes("503"));
  assert.ok(result.screenshotBuffer);
});

test("executeEnvironmentCheck returns LoginFailed when login page is unreachable", async () => {
  const context = buildContext({
    loginUrl: "https://staging.example.test/login",
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.LoginFailed,
      statusReason: "Received HTTP 404 from login page.",
      screenshotBuffer: null,
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.LoginFailed);
  assert.ok(result.statusReason!.includes("404"));
});

test("executeEnvironmentCheck returns LoginFailed when credentials are rejected", async () => {
  const context = buildContext({
    authMode: AuthMode.UsernamePassword,
    loginUrl: "https://staging.example.test/login",
    username: "admin",
    password: "wrong-password",
    postLoginVerificationHint: "Dashboard",
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.LoginFailed,
      statusReason:
        'Post-login verification failed: could not find "Dashboard" on the page after login.',
      screenshotBuffer: Buffer.from("login-failed-screenshot"),
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.LoginFailed);
  assert.ok(result.statusReason!.includes("Dashboard"));
  assert.ok(result.screenshotBuffer);
});

test("executeEnvironmentCheck returns LoginFailed when form fields are not found", async () => {
  const context = buildContext({
    authMode: AuthMode.UsernamePassword,
    loginUrl: "https://staging.example.test/login",
    username: "admin",
    password: "password",
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.LoginFailed,
      statusReason:
        "Could not find a username or email input field on the login page.",
      screenshotBuffer: Buffer.from("no-form-screenshot"),
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.LoginFailed);
  assert.ok(result.statusReason!.includes("username"));
});

// ---------------------------------------------------------------------------
// Timeout scenarios
// ---------------------------------------------------------------------------

test("executeEnvironmentCheck returns Timeout from driver", async () => {
  const context = buildContext({ timeoutMs: 1000 });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.Timeout,
      statusReason: "Environment check timed out.",
      screenshotBuffer: null,
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.Timeout);
  assert.ok(result.statusReason!.includes("timed out"));
  assert.equal(result.screenshotBuffer, null);
});

test("executeEnvironmentCheck returns Timeout when driver throws TimeoutError", async () => {
  const context = buildContext({ timeoutMs: 1000 });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => {
      const error = new Error("Timeout 1000ms exceeded.");
      error.name = "TimeoutError";
      throw error;
    },
  });

  assert.equal(result.status, EnvironmentCheckStatus.Timeout);
  assert.ok(result.statusReason!.includes("Timeout"));
});

test("executeEnvironmentCheck returns BaseUrlUnreachable when driver throws non-timeout error", async () => {
  const context = buildContext();

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => {
      throw new Error("net::ERR_NAME_NOT_RESOLVED");
    },
  });

  assert.equal(result.status, EnvironmentCheckStatus.BaseUrlUnreachable);
  assert.ok(result.statusReason!.includes("ERR_NAME_NOT_RESOLVED"));
});

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

test("redactSecrets replaces username in error messages", () => {
  const context = buildContext({ username: "admin@corp.test", password: null });
  const message = "Failed to authenticate admin@corp.test with the server.";

  const redacted = redactSecrets(message, context);

  assert.equal(
    redacted,
    "Failed to authenticate [REDACTED] with the server.",
  );
  assert.ok(!redacted.includes("admin@corp.test"));
});

test("redactSecrets replaces password in error messages", () => {
  const context = buildContext({ username: null, password: "MyS3cr3tP@ss!" });
  const message = "Login failed with password MyS3cr3tP@ss! for some reason.";

  const redacted = redactSecrets(message, context);

  assert.equal(
    redacted,
    "Login failed with password [REDACTED] for some reason.",
  );
  assert.ok(!redacted.includes("MyS3cr3tP@ss!"));
});

test("redactSecrets replaces both username and password", () => {
  const context = buildContext({
    username: "testuser",
    password: "testpass",
  });
  const message = "Auth failed: testuser / testpass rejected.";

  const redacted = redactSecrets(message, context);

  assert.equal(redacted, "Auth failed: [REDACTED] / [REDACTED] rejected.");
  assert.ok(!redacted.includes("testuser"));
  assert.ok(!redacted.includes("testpass"));
});

test("redactSecrets handles multiple occurrences of the same secret", () => {
  const context = buildContext({ username: "admin", password: null });
  const message = "admin tried to login as admin but admin was rejected.";

  const redacted = redactSecrets(message, context);

  assert.ok(!redacted.includes("admin"));
  assert.equal(
    redacted,
    "[REDACTED] tried to login as [REDACTED] but [REDACTED] was rejected.",
  );
});

test("redactSecrets returns message unchanged when no secrets present", () => {
  const context = buildContext({ username: null, password: null });
  const message = "Base URL is unreachable.";

  const redacted = redactSecrets(message, context);

  assert.equal(redacted, "Base URL is unreachable.");
});

test("executeEnvironmentCheck redacts secrets in driver error messages", async () => {
  const context = buildContext({
    authMode: AuthMode.UsernamePassword,
    loginUrl: "https://staging.example.test/login",
    username: "secretuser",
    password: "secretpass",
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => ({
      status: EnvironmentCheckStatus.LoginFailed,
      statusReason:
        "Login failed for secretuser with password secretpass on the server.",
      screenshotBuffer: null,
    }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.LoginFailed);
  assert.ok(!result.statusReason!.includes("secretuser"));
  assert.ok(!result.statusReason!.includes("secretpass"));
  assert.ok(result.statusReason!.includes("[REDACTED]"));
});

test("executeEnvironmentCheck redacts secrets in driver exception messages", async () => {
  const context = buildContext({
    authMode: AuthMode.UsernamePassword,
    loginUrl: "https://staging.example.test/login",
    username: "admin",
    password: "hunter2",
  });

  const result = await executeEnvironmentCheck(context, {
    browserDriver: async () => {
      throw new Error("Connection failed for admin with hunter2");
    },
  });

  assert.ok(!result.statusReason!.includes("admin"));
  assert.ok(!result.statusReason!.includes("hunter2"));
  assert.ok(result.statusReason!.includes("[REDACTED]"));
});

// ---------------------------------------------------------------------------
// Driver receives correct context
// ---------------------------------------------------------------------------

test("executeEnvironmentCheck passes full context to browser driver", async () => {
  const context = buildContext({
    baseUrl: "https://app.example.test",
    authMode: AuthMode.UsernamePassword,
    loginUrl: "https://app.example.test/login",
    loginInstructions: "Use SSO",
    username: "user@example.test",
    password: "pass123",
    postLoginVerificationHint: "Welcome",
    timeoutMs: 15_000,
  });

  let receivedContext: EnvironmentCheckContext | null = null;
  const driver: EnvironmentCheckBrowserDriver = async (ctx) => {
    receivedContext = ctx;
    return {
      status: EnvironmentCheckStatus.Ready,
      statusReason: "OK",
      screenshotBuffer: null,
    };
  };

  await executeEnvironmentCheck(context, { browserDriver: driver });

  assert.deepEqual(receivedContext, context);
});

test("executeEnvironmentCheck does not call driver when configuration is invalid", async () => {
  let driverCalled = false;
  const driver: EnvironmentCheckBrowserDriver = async () => {
    driverCalled = true;
    return {
      status: EnvironmentCheckStatus.Ready,
      statusReason: "OK",
      screenshotBuffer: null,
    };
  };

  // Missing base URL.
  await executeEnvironmentCheck(buildContext({ baseUrl: "" }), {
    browserDriver: driver,
  });

  assert.equal(driverCalled, false);
});

// ---------------------------------------------------------------------------
// Screenshot buffer pass-through
// ---------------------------------------------------------------------------

test("executeEnvironmentCheck passes screenshot buffer from driver", async () => {
  const screenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
  const context = buildContext();

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver({ screenshotBuffer: screenshot }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.ok(result.screenshotBuffer);
  assert.deepEqual(result.screenshotBuffer, screenshot);
});

test("executeEnvironmentCheck returns null screenshot when driver returns null", async () => {
  const context = buildContext();

  const result = await executeEnvironmentCheck(context, {
    browserDriver: successDriver({ screenshotBuffer: null }),
  });

  assert.equal(result.status, EnvironmentCheckStatus.Ready);
  assert.equal(result.screenshotBuffer, null);
});
