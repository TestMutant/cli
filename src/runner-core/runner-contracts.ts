import type { components } from "../generated/api";

export type BrowserFormElement = components["schemas"]["BrowserFormElement"];
export type BrowserInputElement = components["schemas"]["BrowserInputElement"];
export type BrowserInteractiveElement = components["schemas"]["BrowserInteractiveElement"];
export type BrowserSnapshotRequest = components["schemas"]["BrowserSnapshotRequest"];
export type BrowserSnapshotResponse = components["schemas"]["BrowserSnapshotResponse"];
export type BrowserTextElement = components["schemas"]["BrowserTextElement"];
export type CheckRequest = components["schemas"]["CheckRequest"];
export type ClickRequest = components["schemas"]["ClickRequest"];
export type CreateRunnerSessionRequest = components["schemas"]["CreateRunnerSessionRequest"];
export type CreateRunnerSessionResponse = components["schemas"]["CreateRunnerSessionResponse"];
export type EndRunnerSessionResponse = components["schemas"]["EndRunnerSessionResponse"];
export type ExecutePlaywrightTestsRequest = components["schemas"]["ExecutePlaywrightTestsRequest"];
export type FillRequest = components["schemas"]["FillRequest"];
export type NavigateRequest = components["schemas"]["NavigateRequest"];
export type NavigateResponse = components["schemas"]["NavigateResponse"];
export type PressRequest = components["schemas"]["PressRequest"];
export type RunnerArtifactReference = components["schemas"]["RunnerArtifactReference"] & {
  artifactId?: string | null;
  executionId?: string | null;
};
export type RunnerCandidateLocator = components["schemas"]["RunnerCandidateLocator"];
export type RunnerTestResult = Omit<components["schemas"]["RunnerTestResult"], "artifacts"> & {
  artifacts: RunnerArtifactReference[];
};
export type RunnerExecutionSummary = Omit<components["schemas"]["RunnerExecutionSummary"], "tests"> & {
  tests: RunnerTestResult[];
  executionId?: string | null;
  suiteStatus?: string | null;
};
export type RunnerLogEntry = components["schemas"]["RunnerLogEntry"];
export type RunnerNetworkEntry = components["schemas"]["RunnerNetworkEntry"];
export type RunnerSessionPreparationResponse = components["schemas"]["RunnerSessionPreparationResponse"];
export type RunnerRepairFeedback = components["schemas"]["RunnerRepairFeedback"];
export type RunnerTestDefinition = components["schemas"]["RunnerTestDefinition"];
export type ScreenshotRequest = components["schemas"]["ScreenshotRequest"];
export type SelectRequest = components["schemas"]["SelectRequest"];
export type ValidateDraftPlaywrightTestRequest = components["schemas"]["ValidateDraftPlaywrightTestRequest"];
export type ValidateDraftPlaywrightTestResponse = components["schemas"]["ValidateDraftPlaywrightTestResponse"];
export type InternalRunnerEnvironmentPayload = components["schemas"]["InternalRunnerEnvironmentPayload"];

export type RunnerHealthResponse = {
  status: "ok" | "degraded";
  runnerInstanceId: string;
  version: string | null;
  capabilities: string[];
  activeSessions: number;
  maxSessions: number;
};
