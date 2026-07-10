import { randomUUID } from "node:crypto";
import { resolveArtifactDirectory } from "../runner-core/artifacts";
import { BrowserSession } from "../runner-core/browser-session";
import type {
  CreateRunnerSessionRequest,
  CreateRunnerSessionResponse,
  EndRunnerSessionResponse,
  RunnerSessionPreparationResponse,
} from "../runner-core/runner-contracts";
import type { RunnerServiceConfig } from "./config";
import { RunnerHttpError } from "./errors";

export type RunnerSessionRecord = {
  sessionId: string;
  runnerInstanceId: string;
  createdAtUtc: string;
  expiresAtUtc: string;
  baseUrl: string | null;
  artifactDirectory: string;
  metadata: Record<string, string> | null;
  browserSession: BrowserSession;
};

export class SessionStore {
  private readonly sessions = new Map<string, RunnerSessionRecord>();

  constructor(private readonly config: RunnerServiceConfig) {}

  get activeSessions(): number {
    this.cleanupExpired().catch(() => {});
    return this.sessions.size;
  }

  async create(
    request: CreateRunnerSessionRequest,
  ): Promise<CreateRunnerSessionResponse> {
    await this.cleanupExpired();

    if (this.sessions.size >= this.config.maxSessions) {
      throw new RunnerHttpError(
        429,
        "max_sessions_exceeded",
        "Runner has no available session capacity.",
      );
    }

    const sessionId = randomUUID();
    const createdAtUtc = new Date().toISOString();
    const expiresAtUtc = new Date(Date.now() + this.config.sessionTimeoutMs).toISOString();
    const artifactDirectory = resolveArtifactDirectory(
      this.config.artifactDir,
      sessionId,
      request.artifactDirectory,
    );
    const browserSession = await BrowserSession.create({
      sessionId,
      baseUrl: request.baseUrl,
      environment: request.environment ?? null,
      artifactDirectory,
      headless: request.headless ?? this.config.headless,
      timeoutMs: toNumber(request.timeoutMs) ?? this.config.sessionTimeoutMs,
    });

    this.sessions.set(sessionId, {
      sessionId,
      runnerInstanceId: this.config.runnerInstanceId,
      createdAtUtc,
      expiresAtUtc,
      baseUrl: request.baseUrl,
      artifactDirectory,
      metadata: request.metadata,
      browserSession,
    });

    return {
      sessionId,
      runnerInstanceId: this.config.runnerInstanceId,
      startedAtUtc: createdAtUtc,
      expiresAtUtc,
      browserName: "chromium",
      runnerVersion: this.config.version,
    };
  }

  get(sessionId: string): RunnerSessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new RunnerHttpError(404, "session_not_found", "Runner session was not found.");
    }

    if (Date.parse(session.expiresAtUtc) <= Date.now()) {
      void this.end(sessionId);
      throw new RunnerHttpError(404, "session_expired", "Runner session has expired.");
    }

    return session;
  }

  async prepare(sessionId: string): Promise<RunnerSessionPreparationResponse> {
    return await this.get(sessionId).browserSession.prepare();
  }

  async end(sessionId: string): Promise<EndRunnerSessionResponse> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      await session.browserSession.close();
    }

    return {
      sessionId,
      endedAtUtc: new Date().toISOString(),
    };
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.end(sessionId)));
  }

  async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (Date.parse(session.expiresAtUtc) <= now) {
        await this.end(sessionId);
      }
    }
  }
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
