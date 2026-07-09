import type { IncomingMessage } from "node:http";
import { DEFAULT_REQUEST_BODY_LIMIT_BYTES } from "../runner-core/limits";
import { RunnerHttpError } from "./errors";

export async function readJsonBody<T>(
  request: IncomingMessage,
  limitBytes = DEFAULT_REQUEST_BODY_LIMIT_BYTES,
): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > limitBytes) {
      throw new RunnerHttpError(400, "request_too_large", "Request body is too large.");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new RunnerHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}
