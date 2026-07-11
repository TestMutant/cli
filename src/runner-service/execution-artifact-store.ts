import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { RunnerArtifactReference, RunnerExecutionSummary } from "../runner-core/runner-contracts";

type StoredArtifact = {
  path: string;
  contentType: string;
  sizeBytes: number | null;
};

export class ExecutionArtifactStore {
  private readonly executions = new Map<string, { directory: string; artifacts: Map<string, StoredArtifact> }>();

  register(executionId: string, directory: string, summary: RunnerExecutionSummary): RunnerExecutionSummary {
    const artifacts = new Map<string, StoredArtifact>();
    const tests = summary.tests.map((test) => ({
      ...test,
      artifacts: test.artifacts.map((artifact) => this.registerArtifact(executionId, directory, artifact, artifacts)),
    }));
    this.executions.set(executionId, { directory: resolve(directory), artifacts });
    return { ...summary, tests, executionId, suiteStatus: "completed" };
  }

  open(executionId: string, artifactId: string) {
    const artifact = this.executions.get(executionId)?.artifacts.get(artifactId);
    return artifact ? { ...artifact, stream: createReadStream(artifact.path) } : null;
  }

  async cleanup(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    this.executions.delete(executionId);
    if (execution) await rm(execution.directory, { recursive: true, force: true });
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.executions.keys()].map((id) => this.cleanup(id)));
  }

  private registerArtifact(
    executionId: string,
    directory: string,
    artifact: RunnerArtifactReference,
    artifacts: Map<string, StoredArtifact>,
  ): RunnerArtifactReference {
    if (!artifact.path) return { ...artifact, path: null, artifactId: null, executionId };
    const root = resolve(directory);
    const path = resolve(artifact.path);
    if (path !== root && !path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) {
      return { ...artifact, path: null, artifactId: null, executionId };
    }
    const artifactId = randomUUID();
    artifacts.set(artifactId, {
      path,
      contentType: artifact.contentType ?? "application/octet-stream",
      sizeBytes: typeof artifact.sizeBytes === "number" ? artifact.sizeBytes : null,
    });
    return { ...artifact, path: null, artifactId, executionId };
  }
}
