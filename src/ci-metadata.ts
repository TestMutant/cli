import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { CliCreateRunRequest } from "./api-client";
import { CliError } from "./config";

type RepositoryMetadata = {
  provider: string | null;
  fullName: string | null;
};

export function buildCreateRunRequest(): CliCreateRunRequest {
  const env = process.env;
  const gitRepository = getGitRepositoryMetadata();
  const repositoryProvider =
    normalize(env.TESTMUTANT_REPOSITORY_PROVIDER) ??
    detectRepositoryProvider(env) ??
    gitRepository.provider;
  const repositoryFullName =
    normalize(env.TESTMUTANT_REPOSITORY_FULL_NAME) ??
    detectRepositoryFullName(env) ??
    gitRepository.fullName;

  if (!repositoryFullName) {
    throw new CliError(
      "Could not determine repository full name from CI environment or git remote origin.",
      2,
    );
  }

  return {
    mode: "Advisory",
    runKind: "Advisory",
    repositoryProvider: repositoryProvider ?? "GitHub",
    repositoryFullName,
    baseUrl: detectBaseUrl(env),
    environmentName: detectEnvironmentName(env),
    branch: detectBranch(env) ?? git(["rev-parse", "--abbrev-ref", "HEAD"]),
    commitSha: detectCommitSha(env) ?? git(["rev-parse", "HEAD"]),
    pullRequestNumber: detectPullRequestNumber(env),
    ciProvider: detectCiProvider(env),
    ciRunId: detectCiRunId(env),
  } satisfies CliCreateRunRequest;
}

function detectRepositoryProvider(env: NodeJS.ProcessEnv): string | null {
  if (env.GITHUB_ACTIONS || env.GITHUB_REPOSITORY) {
    return "GitHub";
  }

  if (env.GITLAB_CI || env.CI_PROJECT_PATH) {
    return "GitLab";
  }

  if (env.BITBUCKET_BUILD_NUMBER || env.BITBUCKET_REPO_FULL_NAME) {
    return "Bitbucket";
  }

  if (env.TF_BUILD || env.BUILD_REPOSITORY_URI) {
    return "AzureDevOps";
  }

  return null;
}

function detectRepositoryFullName(env: NodeJS.ProcessEnv): string | null {
  if (env.GITHUB_REPOSITORY) {
    return normalize(env.GITHUB_REPOSITORY);
  }

  if (env.GITLAB_CI && env.CI_PROJECT_PATH) {
    return normalize(env.CI_PROJECT_PATH);
  }

  if (env.BITBUCKET_REPO_FULL_NAME) {
    return normalize(env.BITBUCKET_REPO_FULL_NAME);
  }

  if (env.CIRCLE_PROJECT_USERNAME && env.CIRCLE_PROJECT_REPONAME) {
    return `${env.CIRCLE_PROJECT_USERNAME}/${env.CIRCLE_PROJECT_REPONAME}`;
  }

  if (env.BUILD_REPOSITORY_NAME) {
    return normalize(env.BUILD_REPOSITORY_NAME);
  }

  return null;
}

function detectBranch(env: NodeJS.ProcessEnv): string | null {
  return (
    normalize(env.GITHUB_HEAD_REF) ??
    normalize(env.GITHUB_REF_NAME) ??
    branchFromGitRef(env.GITHUB_REF) ??
    normalize(env.CI_COMMIT_REF_NAME) ??
    normalize(env.BITBUCKET_BRANCH) ??
    normalize(env.CIRCLE_BRANCH) ??
    normalize(env.BUILDKITE_BRANCH) ??
    normalize(env.BUILD_SOURCEBRANCHNAME) ??
    branchFromGitRef(env.BUILD_SOURCEBRANCH)
  );
}

function detectCommitSha(env: NodeJS.ProcessEnv): string | null {
  return (
    normalize(env.GITHUB_SHA) ??
    normalize(env.CI_COMMIT_SHA) ??
    normalize(env.BITBUCKET_COMMIT) ??
    normalize(env.CIRCLE_SHA1) ??
    normalize(env.BUILDKITE_COMMIT) ??
    normalize(env.BUILD_SOURCEVERSION)
  );
}

function detectPullRequestNumber(
  env: NodeJS.ProcessEnv,
): number | string | null {
  return (
    numberFromValue(env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)?.[1]) ??
    githubEventPullRequestNumber(env) ??
    numberFromValue(env.CI_MERGE_REQUEST_IID) ??
    numberFromValue(env.BITBUCKET_PR_ID) ??
    numberFromValue(env.CIRCLE_PULL_REQUEST?.split("/").pop()) ??
    numberFromValue(env.BUILDKITE_PULL_REQUEST) ??
    numberFromValue(env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER)
  );
}

function detectCiProvider(env: NodeJS.ProcessEnv): string | null {
  if (env.GITHUB_ACTIONS) {
    return "GitHubActions";
  }

  if (env.GITLAB_CI) {
    return "GitLabCI";
  }

  if (env.BITBUCKET_BUILD_NUMBER) {
    return "BitbucketPipelines";
  }

  if (env.CIRCLECI) {
    return "CircleCI";
  }

  if (env.BUILDKITE) {
    return "Buildkite";
  }

  if (env.TF_BUILD) {
    return "AzurePipelines";
  }

  if (env.JENKINS_URL) {
    return "Jenkins";
  }

  return env.CI ? "CI" : null;
}

function detectCiRunId(env: NodeJS.ProcessEnv): string | null {
  return (
    normalize(env.GITHUB_RUN_ID) ??
    normalize(env.CI_PIPELINE_ID) ??
    normalize(env.BITBUCKET_BUILD_NUMBER) ??
    normalize(env.CIRCLE_WORKFLOW_ID) ??
    normalize(env.CIRCLE_BUILD_NUM) ??
    normalize(env.BUILDKITE_BUILD_ID) ??
    normalize(env.BUILD_BUILDID) ??
    normalize(env.BUILD_TAG) ??
    normalize(env.BUILD_NUMBER)
  );
}

function detectBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return (
    normalizeUrl(env.TESTMUTANT_BASE_URL) ??
    normalizeUrl(env.DEPLOY_URL) ??
    normalizeUrl(env.URL) ??
    normalizeUrl(env.VERCEL_BRANCH_URL) ??
    normalizeUrl(env.VERCEL_URL) ??
    normalizeUrl(env.CF_PAGES_URL) ??
    normalizeUrl(env.RENDER_EXTERNAL_URL)
  );
}

function detectEnvironmentName(env: NodeJS.ProcessEnv): string | null {
  return (
    normalize(env.TESTMUTANT_ENVIRONMENT) ??
    normalize(env.CI_ENVIRONMENT_NAME) ??
    normalize(env.VERCEL_ENV) ??
    normalize(env.NETLIFY_CONTEXT) ??
    normalize(env.CF_PAGES_BRANCH)
  );
}

function githubEventPullRequestNumber(env: NodeJS.ProcessEnv): number | null {
  const eventPath = normalize(env.GITHUB_EVENT_PATH);
  if (!eventPath || !existsSync(eventPath)) {
    return null;
  }

  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
      number?: unknown;
      pull_request?: { number?: unknown };
    };
    return (
      numberFromValue(event.pull_request?.number) ?? numberFromValue(event.number)
    );
  } catch {
    return null;
  }
}

function getGitRepositoryMetadata(): RepositoryMetadata {
  const remote = git(["remote", "get-url", "origin"]);
  return remote ? parseGitRemoteUrl(remote) : { provider: null, fullName: null };
}

function parseGitRemoteUrl(remoteUrl: string): RepositoryMetadata {
  const remote = remoteUrl.trim();
  const url = parseRemoteAsUrl(remote);
  const host = url?.host ?? parseScpRemoteHost(remote);
  const path = url?.pathname ?? parseScpRemotePath(remote);
  const fullName = path
    ?.replace(/^\/+/, "")
    .replace(/\.git$/i, "")
    .replace(/^v\d+\//i, "");

  return {
    provider: host ? providerFromHost(host) : null,
    fullName: normalize(fullName),
  };
}

function parseRemoteAsUrl(remote: string): URL | null {
  try {
    return new URL(remote.replace(/^git\+/, ""));
  } catch {
    return null;
  }
}

function parseScpRemoteHost(remote: string): string | null {
  return remote.match(/^(?:[^@]+@)?([^:]+):(.+)$/)?.[1] ?? null;
}

function parseScpRemotePath(remote: string): string | null {
  return remote.match(/^(?:[^@]+@)?([^:]+):(.+)$/)?.[2] ?? null;
}

function providerFromHost(host: string): string | null {
  const normalized = host.toLowerCase();
  if (normalized.includes("github")) {
    return "GitHub";
  }

  if (normalized.includes("gitlab")) {
    return "GitLab";
  }

  if (normalized.includes("bitbucket")) {
    return "Bitbucket";
  }

  if (normalized.includes("dev.azure") || normalized.includes("visualstudio")) {
    return "AzureDevOps";
  }

  return null;
}

function branchFromGitRef(value: string | undefined): string | null {
  const ref = normalize(value);
  if (!ref) {
    return null;
  }

  return (
    ref.match(/^refs\/heads\/(.+)$/)?.[1] ??
    ref.match(/^refs\/tags\/(.+)$/)?.[1] ??
    null
  );
}

function normalizeUrl(value: string | undefined): string | null {
  const normalized = normalize(value);
  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `https://${normalized}`;
}

function numberFromValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  if (value.toLowerCase() === "false") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalize(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function git(args: string[]): string | null {
  try {
    const safeDirectory = process.cwd().replace(/\\/g, "/");
    return normalize(
      execFileSync("git", ["-c", `safe.directory=${safeDirectory}`, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}
