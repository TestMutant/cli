import type { operations } from "./generated/api";
import { CliError } from "./config";

export type PingResponse =
  operations["CliV1_Ping"]["responses"][200]["content"]["application/json"];

export type TestMutantApiClientOptions = {
  apiKey: string;
  apiUrl: string;
  timeoutMs: number;
  userAgent: string;
};

export class TestMutantApiClient {
  constructor(private readonly options: TestMutantApiClientOptions) {}

  async ping(): Promise<PingResponse> {
    return this.getJson<PingResponse>("/api/cli/v1/ping");
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path);

    if (response.status === 401) {
      throw new CliError("Unauthorized. Check your TestMutant API key.", 3);
    }

    if (!response.ok) {
      const body = await response.text();
      const detail = body ? ` ${truncate(body, 500)}` : "";
      throw new CliError(
        `TestMutant API request failed with HTTP ${response.status}.${detail}`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new CliError("TestMutant API returned invalid JSON.");
    }
  }

  private async request(path: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      return await fetch(new URL(path, this.options.apiUrl), {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}
