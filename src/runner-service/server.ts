import { createServer, type Server } from "node:http";
import type { RunnerServiceConfig } from "./config";
import { handleRunnerRequest } from "./routes";
import { SessionStore } from "./session-store";
import { ExecutionArtifactStore } from "./execution-artifact-store";

export type RunnerServiceHandle = {
  server: Server;
  sessions: SessionStore;
  executions: ExecutionArtifactStore;
  stop(): Promise<void>;
};

export async function startRunnerService(
  config: RunnerServiceConfig,
): Promise<RunnerServiceHandle> {
  const sessions = new SessionStore(config);
  const executions = new ExecutionArtifactStore();
  const server = createServer((request, response) => {
    void handleRunnerRequest(request, response, { config, sessions, executions }).catch((error) => {
      console.error(`runner-service request failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    sessions,
    executions,
    async stop() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await sessions.closeAll();
      await executions.closeAll();
    },
  };
}
