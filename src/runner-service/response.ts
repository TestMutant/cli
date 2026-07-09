import { ServerResponse } from "node:http";
import { RunnerHttpError, isTimeoutError } from "./errors";
import { safeErrorMessage } from "../runner-core/redaction";

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  response.end(json);
}

export function sendError(
  response: ServerResponse,
  error: unknown,
  secrets: string[] = [],
): void {
  if (error instanceof RunnerHttpError) {
    sendJson(response, error.statusCode, {
      error: {
        code: error.code,
        message: safeErrorMessage(error.message, secrets),
      },
    });
    return;
  }

  if (isTimeoutError(error)) {
    sendJson(response, 504, {
      error: {
        code: "timeout",
        message: safeErrorMessage(error, secrets),
      },
    });
    return;
  }

  sendJson(response, 500, {
    error: {
      code: "runner_failure",
      message: safeErrorMessage(error, secrets) || "Runner request failed.",
    },
  });
}
