export class RunnerHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunnerHttpError";
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error &&
    /timeout|timed out|Timeout/i.test(error.message);
}
