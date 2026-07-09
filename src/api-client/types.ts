export type NumericEnum = number;
export type JsonNumber = number | string;

export type PingResponse = {
  ok: boolean;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  repositoryMatched: boolean | null;
  repositoryId: string | null;
  repositoryFullName: string | null;
  cliApiVersion: string;
};

export type CliPingRequest = {
  repositoryProvider: string | null;
  repositoryFullName: string | null;
};

export type CliCreateRunRequest = {
  runKind: string | null;
  repositoryProvider: string | null;
  repositoryFullName: string | null;
  baseUrl: string | null;
  environmentName: string | null;
  branch: string | null;
  commitSha: string | null;
  pullRequestNumber: JsonNumber | null;
  ciProvider: string | null;
  ciRunId: string | null;
  testSpecId?: string | null;
};

export type CliTestResult = {
  implementationId: string;
  status: NumericEnum;
  durationMs: JsonNumber | null;
  errorMessage: string | null;
  stackTrace: string | null;
  environmentUrl?: string | null;
  startedAtUtc?: string | null;
  completedAtUtc?: string | null;
  failureClassification?: NumericEnum | null;
  outputJson?: string | null;
};

export type CliCompleteRunRequest = {
  status: string | null;
  summary: string | null;
  errorMessage: string | null;
  results?: CliTestResult[] | null;
};

export type CliCompleteRunResponse = {
  ok: boolean;
  runId: string;
  status: NumericEnum;
};

export type CliRunImplementation = {
  implementationId: string;
  testSpecId: string;
  testLayer: string;
  runnerKind: string;
  name: string;
  source: string;
};

export type CliRunCreatedResponse = {
  runId: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryFullName: string;
  runKind: NumericEnum;
  status: NumericEnum;
  testSpecId: string | null;
  implementations: CliRunImplementation[];
  runner: HostedRunnerPayload;
};

export type HostedRunnerArtifactUploadInstructions = {
  maxArtifactSizeBytes: JsonNumber;
  callbackBasePath: string;
  heartbeatPath: string;
  screenshotPathTemplate: string;
};

export type HostedRunnerArtifactUploadRequest = {
  kind: NumericEnum;
  fileName: string | null;
  contentType: string | null;
  contentBase64: string | null;
  runImplementationResultId?: string | null;
  validationAttemptId?: string | null;
  metadataJson?: string | null;
};

export type HostedRunnerArtifactUploadResponse = {
  artifactId: string;
  kind: NumericEnum;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: JsonNumber;
  sha256: string | null;
  retainUntilUtc: string | null;
  createdAtUtc: string;
};

export type HostedRunnerAuthInstructions = {
  authMode: NumericEnum;
  loginUrl: string | null;
  loginInstructions: string | null;
  postLoginVerificationHint: string | null;
  credentialPreview: string | null;
  hasCredentials: boolean;
  username: string | null;
  password: string | null;
};

export type HostedRunnerCompleteRunResultRequest = {
  status: NumericEnum;
  summary?: string | null;
  errorMessage?: string | null;
  totalTests?: JsonNumber | null;
  passedTests?: JsonNumber | null;
  failedTests?: JsonNumber | null;
  skippedTests?: JsonNumber | null;
  durationMs?: JsonNumber | null;
  environmentUrl?: string | null;
  startedAtUtc?: string | null;
  completedAtUtc?: string | null;
  failureClassification?: NumericEnum | null;
};

export type HostedRunnerCompleteRunResultResponse = {
  ok: boolean;
  runId: string;
  status: NumericEnum;
  totalTests: JsonNumber;
  passedTests: JsonNumber;
  failedTests: JsonNumber;
  skippedTests: JsonNumber;
  durationMs: JsonNumber | null;
  failureClassification: NumericEnum;
  completedAtUtc: string | null;
};

export type HostedRunnerEnvironmentContext = {
  environmentConfigurationId: string;
  name: string;
  baseUrl: string;
  timeZoneId: string;
  testDataNotes: string | null;
  requiresPassingEnvironmentCheck: boolean;
  environmentCheckSkippedAtUtc: string | null;
  auth: HostedRunnerAuthInstructions;
};

export type HostedRunnerHeartbeatResponse = {
  ok: boolean;
  organizationId: string;
  projectId: string;
  runId: string;
  hostedRunnerJobId: string;
  lastHeartbeatAtUtc: string;
  expiresAtUtc: string;
};

export type HostedRunnerLimits = {
  runTimeoutSeconds: JsonNumber;
  perTestTimeoutSeconds: JsonNumber;
  maxTestsPerRun: JsonNumber;
  maxArtifactSizeBytes: JsonNumber;
  maxRepairAttempts: JsonNumber;
};

export type HostedRunnerPayload = {
  project: HostedRunnerProjectContext;
  environment: HostedRunnerEnvironmentContext | null;
  testSource: HostedRunnerTestSource;
  limits: HostedRunnerLimits;
  artifactUploads: HostedRunnerArtifactUploadInstructions;
};

export type HostedRunnerProjectContext = {
  organizationId: string;
  organizationName: string | null;
  projectId: string;
  projectName: string;
  runId: string;
  runKind: NumericEnum;
  repositoryFullName: string | null;
  baseUrl: string | null;
  environmentName: string | null;
};

export type HostedRunnerTestDefinition = {
  implementationId: string;
  testSpecId: string;
  requirementId: string | null;
  specTitle: string | null;
  testLayer: string;
  runnerKind: string;
  name: string;
  description: string | null;
  source: string;
  targetPath: string | null;
  status: NumericEnum;
  lifecycleStatus: NumericEnum;
  implementationSource: NumericEnum;
};

export type HostedRunnerTestResultRequest = {
  status: NumericEnum;
  durationMs?: JsonNumber | null;
  environmentUrl?: string | null;
  startedAtUtc?: string | null;
  completedAtUtc?: string | null;
  failureClassification?: NumericEnum | null;
  errorMessage?: string | null;
  stackTrace?: string | null;
  outputJson?: string | null;
};

export type HostedRunnerTestResultResponse = {
  resultId: string;
  runId: string;
  testImplementationId: string;
  testSpecId: string;
  status: NumericEnum;
  durationMs: JsonNumber | null;
  environmentUrl: string | null;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
  failureClassification: NumericEnum;
  createdAtUtc: string;
  validationAttemptId?: string | null;
};

export type HostedRunnerTestSource = {
  sourceKind: string;
  tests: HostedRunnerTestDefinition[];
};
