import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { resolveArtifactDirectory } from "../runner-core/artifacts";
import { executeRunnerTests } from "../runner-core/playwright-runner-adapter";
import type {
  BrowserSnapshotRequest,
  CheckRequest,
  ClickRequest,
  CreateRunnerSessionRequest,
  ExecutePlaywrightTestsRequest,
  FillRequest,
  NavigateRequest,
  PressRequest,
  RunnerHealthResponse,
  ScreenshotRequest,
  SelectRequest,
  ValidateDraftPlaywrightTestRequest,
} from "../runner-core/runner-contracts";
import { requireRunnerAuth } from "./auth";
import { readJsonBody } from "./body";
import type { RunnerServiceConfig } from "./config";
import { RunnerHttpError } from "./errors";
import { sendError, sendJson } from "./response";
import type { SessionStore } from "./session-store";
import type { ExecutionArtifactStore } from "./execution-artifact-store";

export type RouteContext = {
  config: RunnerServiceConfig;
  sessions: SessionStore;
  executions: ExecutionArtifactStore;
};

const CAPABILITIES = [
  "browser.chromium",
  "playwright",
  "browser.session",
  "draft.validation",
  "regression.execution.v1",
  "artifact.download.v1",
];

export async function handleRunnerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteContext,
): Promise<void> {
  try {
    requireRunnerAuth(request, context.config.token);

    const url = new URL(request.url ?? "/", "http://runner.local");
    const pathname = trimTrailingSlash(url.pathname);

    if (request.method === "GET" && pathname === "/healthz") {
      sendJson(response, 200, health(context));
      return;
    }

    if (!pathname.startsWith("/v1")) {
      throw new RunnerHttpError(404, "not_found", "Runner endpoint was not found.");
    }

    const executionArtifactRoute = pathname.match(/^\/v1\/executions\/([^/]+)\/artifacts\/([^/]+)$/);
    if (request.method === "GET" && executionArtifactRoute) {
      const artifact = context.executions.open(
        decodeURIComponent(executionArtifactRoute[1] ?? ""),
        decodeURIComponent(executionArtifactRoute[2] ?? ""),
      );
      if (!artifact) throw new RunnerHttpError(404, "artifact_not_found", "Runner artifact was not found.");
      response.statusCode = 200;
      response.setHeader("Content-Type", artifact.contentType);
      if (artifact.sizeBytes !== null) response.setHeader("Content-Length", artifact.sizeBytes);
      artifact.stream.on("error", () => response.destroy());
      artifact.stream.pipe(response);
      return;
    }

    const executionRoute = pathname.match(/^\/v1\/executions\/([^/]+)$/);
    if (request.method === "DELETE" && executionRoute) {
      await context.executions.cleanup(decodeURIComponent(executionRoute[1] ?? ""));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/sessions") {
      const body = await readJsonBody<CreateRunnerSessionRequest>(request);
      validateCreateSession(body);
      sendJson(response, 200, await context.sessions.create(body));
      return;
    }

    if (request.method === "POST" && pathname === "/v1/execute-tests") {
      const body = await readJsonBody<ExecutePlaywrightTestsRequest>(request);
      validateExecuteTests(body);
      const executionId = randomUUID();
      const artifactDirectory = resolveArtifactDirectory(
        context.config.artifactDir,
        executionId,
        body.artifactDirectory,
      );
      const summary = await executeRunnerTests(body, { artifactDirectory });
      sendJson(response, 200, context.executions.register(executionId, artifactDirectory, summary));
      return;
    }

    const sessionRoute = matchSessionRoute(pathname);
    if (!sessionRoute) {
      throw new RunnerHttpError(404, "not_found", "Runner endpoint was not found.");
    }

    if (request.method === "DELETE" && sessionRoute.action === null) {
      sendJson(response, 200, await context.sessions.end(sessionRoute.sessionId));
      return;
    }

    if (request.method !== "POST" || sessionRoute.action === null) {
      throw new RunnerHttpError(404, "not_found", "Runner endpoint was not found.");
    }

    const session = context.sessions.get(sessionRoute.sessionId);
    const browserSession = session.browserSession;

    switch (sessionRoute.action) {
      case "prepare": {
        sendJson(response, 200, await context.sessions.prepare(sessionRoute.sessionId));
        return;
      }
      case "navigate": {
        const body = await readJsonBody<NavigateRequest>(request);
        validateRequiredString(body.url, "url");
        sendJson(response, 200, await browserSession.navigate(body));
        return;
      }
      case "snapshot": {
        sendJson(
          response,
          200,
          await browserSession.snapshot(await readJsonBody<BrowserSnapshotRequest>(request)),
        );
        return;
      }
      case "click": {
        const body = await readJsonBody<ClickRequest>(request);
        validateRequiredString(body.locator, "locator");
        sendJson(response, 200, await browserSession.click(body));
        return;
      }
      case "fill": {
        const body = await readJsonBody<FillRequest>(request);
        validateRequiredString(body.locator, "locator");
        sendJson(response, 200, await browserSession.fill(body));
        return;
      }
      case "press": {
        const body = await readJsonBody<PressRequest>(request);
        validateRequiredString(body.key, "key");
        sendJson(response, 200, await browserSession.press(body));
        return;
      }
      case "select": {
        const body = await readJsonBody<SelectRequest>(request);
        validateRequiredString(body.locator, "locator");
        sendJson(response, 200, await browserSession.select(body));
        return;
      }
      case "check": {
        const body = await readJsonBody<CheckRequest>(request);
        validateRequiredString(body.locator, "locator");
        sendJson(response, 200, await browserSession.check(body));
        return;
      }
      case "screenshot": {
        sendJson(
          response,
          200,
          await browserSession.screenshot(await readJsonBody<ScreenshotRequest>(request)),
        );
        return;
      }
      case "console": {
        sendJson(response, 200, browserSession.getConsoleEntries());
        return;
      }
      case "network": {
        sendJson(response, 200, browserSession.getNetworkEntries());
        return;
      }
      case "validate-draft": {
        const body = await readJsonBody<ValidateDraftPlaywrightTestRequest>(request);
        validateRequiredString(body.name, "name");
        validateRequiredString(body.source, "source");
        if (body.environment) {
          throw new RunnerHttpError(
            400,
            "draft_environment_not_allowed",
            "Draft validation uses the prepared session and does not accept an environment payload.",
          );
        }
        sendJson(response, 200, await browserSession.validateDraft(body));
        return;
      }
      case "execute-tests": {
        const body = await readJsonBody<ExecutePlaywrightTestsRequest>(request);
        validateExecuteTests(body);
        const executionId = randomUUID();
        const artifactDirectory = resolveArtifactDirectory(
          session.artifactDirectory,
          executionId,
          null,
        );
        const controller = new AbortController();
        request.once("aborted", () => controller.abort());
        const summary = await browserSession.executeTests(body, artifactDirectory, controller.signal);
        sendJson(response, 200, context.executions.register(executionId, artifactDirectory, summary));
        return;
      }
    }
  } catch (error) {
    sendError(response, error, [context.config.token ?? ""]);
  }
}

function health(context: RouteContext): RunnerHealthResponse {
  const activeSessions = context.sessions.activeSessions;
  return {
    status: activeSessions < context.config.maxSessions ? "ok" : "degraded",
    runnerInstanceId: context.config.runnerInstanceId,
    version: context.config.version,
    capabilities: CAPABILITIES,
    activeSessions,
    maxSessions: context.config.maxSessions,
  };
}

function matchSessionRoute(pathname: string): {
  sessionId: string;
  action:
    | null
    | "navigate"
    | "snapshot"
    | "click"
    | "fill"
    | "press"
    | "select"
    | "check"
    | "screenshot"
    | "console"
    | "network"
    | "prepare"
    | "validate-draft"
    | "execute-tests";
} | null {
  const match = pathname.match(/^\/v1\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) {
    return null;
  }

  const action = match[2] ?? null;
  if (
    action !== null &&
    ![
      "navigate",
      "snapshot",
      "click",
      "fill",
      "press",
      "select",
      "check",
      "screenshot",
      "console",
      "network",
      "prepare",
      "validate-draft",
      "execute-tests",
    ].includes(action)
  ) {
    return null;
  }

  return {
    sessionId: decodeURIComponent(match[1] ?? ""),
    action: action as never,
  };
}

function validateCreateSession(request: CreateRunnerSessionRequest): void {
  if (request.baseUrl !== null && request.baseUrl !== undefined) {
    validateRequiredString(request.baseUrl, "baseUrl");
  }
}

function validateExecuteTests(request: ExecutePlaywrightTestsRequest): void {
  if (!Array.isArray(request.tests)) {
    throw new RunnerHttpError(400, "invalid_request", "tests must be an array.");
  }

  for (const test of request.tests) {
    validateRequiredString(test.testId, "testId");
    validateRequiredString(test.name, "name");
    validateRequiredString(test.runnerKind, "runnerKind");
    validateRequiredString(test.source, "source");
  }
}

function validateRequiredString(value: unknown, field: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new RunnerHttpError(400, "invalid_request", `${field} is required.`);
  }
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}
