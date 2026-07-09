import { resolveRunnerServiceConfig, type RunnerServiceCliOptions } from "../runner-service/config";
import { startRunnerService } from "../runner-service/server";

export async function runRunnerServiceCommand(
  options: RunnerServiceCliOptions,
  version: string,
): Promise<void> {
  const config = resolveRunnerServiceConfig(options, version);
  const handle = await startRunnerService(config);

  console.error(
    `TestMutant runner service listening on ${config.host}:${config.port} (${config.runnerInstanceId})`,
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }

    stopping = true;
    console.error("TestMutant runner service shutting down.");
    await handle.stop();
  };

  process.once("SIGINT", () => {
    void stop().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().then(() => process.exit(0));
  });

  await new Promise<void>(() => {});
}
