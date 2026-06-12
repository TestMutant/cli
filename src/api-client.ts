import type { components, operations } from "./generated/api";
import { CliError } from "./config";

export type PingResponse =
  operations["CliV1_Ping"]["responses"][200]["content"]["application/json"];
export type CliPingRequest = components["schemas"]["CliPingRequest"];
export type CliCreateRunRequest = components["schemas"]["CliCreateRunRequest"];
export type CliCompleteRunRequest =
  components["schemas"]["CliCompleteRunRequest"];
export type CliRunImplementation = components["schemas"]["CliRunImplementation"];
export type CliRunCreatedResponse =
  operations["CliV1_CreateRun"]["responses"][201]["content"]["application/json"];
export type CliCompleteRunResponse =
  operations["CliV1_CompleteRun"]["responses"][200]["content"]["application/json"];

export type TestMutantApiClientOptions = {
  apiKey: string;
  apiUrl: string;
  timeoutMs: number;
  userAgent: string;
};

export class TestMutantApiClient {
  constructor(private readonly options: TestMutantApiClientOptions) {}

  async ping(): Promise<PingResponse> {
    return this.postJson<PingResponse, CliPingRequest>("/api/cli/v1/ping", {
      repositoryProvider: null,
      repositoryFullName: null,
    });
  }

  async createRun(request: CliCreateRunRequest): Promise<CliRunCreatedResponse> {
    return this.postJson<CliRunCreatedResponse, CliCreateRunRequest>(
      "/api/cli/v1/runs",
      request,
      201,
    );
  }

  async completeRun(
    runId: string,
    request: CliCompleteRunRequest,
  ): Promise<CliCompleteRunResponse> {
    return this.postJson<CliCompleteRunResponse, CliCompleteRunRequest>(
      `/api/cli/v1/runs/${encodeURIComponent(runId)}/complete`,
      request,
    );
  }

  async uploadScreenshot(
    runId: string,
    implementationId: string,
    screenshot: Buffer,
  ): Promise<void> {
    const path = `/api/cli/v1/runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(implementationId)}/screenshot`;
    const formData = new FormData();
    const bytes = screenshot.buffer.slice(
      screenshot.byteOffset,
      screenshot.byteOffset + screenshot.byteLength,
    ) as ArrayBuffer;
<<<<<<< Updated upstream
    formData.append("file", new Blob([bytes], { type: "image/png" }), "screenshot.png");
=======
    formData.append(
      "file",
      new Blob([bytes], { type: "image/png" }),
      "screenshot.png",
    );
>>>>>>> Stashed changes

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(new URL(path, this.options.apiUrl), {
        method: "POST",
        body: formData,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "user-agent": this.options.userAgent,
        },
      });

      if (response.status !== 200) {
        console.error(`Screenshot upload failed with HTTP ${response.status}`);
      }
    } catch {
      // Best-effort: screenshot upload failure should not fail the run.
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postJson<TResponse, TRequest>(
    path: string,
    body: TRequest,
    expectedStatus = 200,
  ): Promise<TResponse> {
    const response = await this.request(path, body);

    if (response.status === 401) {
      throw new CliError("Unauthorized. Check your TestMutant API key.", 3);
    }

    if (response.status !== expectedStatus) {
      const detail = await readErrorDetail(response);
      throw new CliError(
        `TestMutant API request failed with HTTP ${response.status}.${detail}`,
      );
    }

    try {
      return (await response.json()) as TResponse;
    } catch {
      throw new CliError("TestMutant API returned invalid JSON.");
    }
  }

  private async request<TRequest>(
    path: string,
    body: TRequest,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      return await fetch(new URL(path, this.options.apiUrl), {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
          "user-agent": this.options.userAgent,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CliError(
          `TestMutant API request timed out after ${this.options.timeoutMs} ms.`,
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(`Could not reach TestMutant API. ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  const body = await response.text();

  if (!body) {
    return "";
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      const problem = JSON.parse(body) as {
        title?: unknown;
        detail?: unknown;
        errors?: unknown;
      };
      const parts = [
        typeof problem.title === "string" ? problem.title : null,
        typeof problem.detail === "string" ? problem.detail : null,
        formatValidationErrors(problem.errors),
      ].filter((part): part is string => Boolean(part));

      if (parts.length > 0) {
        return ` ${truncate(parts.join(" "), 500)}`;
      }
    } catch {
      return ` ${truncate(body, 500)}`;
    }
  }

  return ` ${truncate(body, 500)}`;
}

function formatValidationErrors(errors: unknown): string | null {
  if (!errors || typeof errors !== "object") {
    return null;
  }

  const messages: string[] = [];
  for (const [field, value] of Object.entries(errors)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          messages.push(`${field}: ${item}`);
        }
      }
    }
  }

  return messages.length > 0 ? messages.join(" ") : null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}
