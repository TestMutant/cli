import { createServer, type Server } from "node:http";
import type { RunnerServiceConfig } from "./config";
import { handleRunnerRequest } from "./routes";
import { SessionStore } from "./session-store";

export type RunnerServiceHandle = {
  server: Server;
  sessions: SessionStore;
  stop(): Promise<void>;
};

export async function startRunnerService(
  config: RunnerServiceConfig,
): Promise<RunnerServiceHandle> {
  const sessions = new SessionStore(config);
  const server = createServer((request, response) => {
    void handleRunnerRequest(request, response, { config, sessions }).catch((error) => {
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
    async stop() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await sessions.closeAll();
    },
  };
}
