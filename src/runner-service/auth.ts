import type { IncomingMessage } from "node:http";
import { RunnerHttpError } from "./errors";

export function requireRunnerAuth(
  request: IncomingMessage,
  token: string | null,
): void {
  if (!token) {
    return;
  }

  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${token}`) {
    throw new RunnerHttpError(401, "unauthorized", "Missing or invalid runner token.");
  }
}
