# Hosted Runner Invocation

This is the internal command contract used by the API host when it starts the
CLI as a hosted runner. These commands are hidden from public help output and
are not part of the customer CI surface.

## Commands

For validation or nightly regression jobs:

```sh
node /app/node_modules/@testmutant/cli/dist/index.js hosted-run
```

For project environment checks:

```sh
node /app/node_modules/@testmutant/cli/dist/index.js hosted-env-check
```

Local Windows development can point at the repo build instead:

```powershell
node C:\repos\sleepycatsoftware\testmutant\testmutant-cli\dist\index.js hosted-run
node C:\repos\sleepycatsoftware\testmutant\testmutant-cli\dist\index.js hosted-env-check
```

The API `HostedRunner` configuration maps directly to `ProcessStartInfo`:

```json
{
  "HostedRunner": {
    "CommandPath": "node",
    "Arguments": "/app/node_modules/@testmutant/cli/dist/index.js hosted-run",
    "WorkingDirectory": "/app"
  }
}
```

For Windows local development, use `CommandPath` `node.exe` and quote the
absolute `dist/index.js` path in `Arguments` when the path contains spaces.

## Environment Variables

The API process starter sets these variables for both hosted commands:

| Name | Required | Description |
| --- | --- | --- |
| `TESTMUTANT_HOSTED_RUNNER_JOB_ID` | Yes | Hosted runner job id. |
| `TESTMUTANT_ORGANIZATION_ID` | Yes | Organization id owning the job. |
| `TESTMUTANT_PROJECT_ID` | Yes | Project id owning the job. |
| `TESTMUTANT_RUN_ID` | Yes | Run id receiving results. |
| `TESTMUTANT_RUNNER_SESSION_TOKEN` | Yes | Short-lived callback bearer token. |
| `TESTMUTANT_HOSTED_RUNNER_PAYLOAD_JSON` | Yes | Serialized `HostedRunnerPayload`. |
| `TESTMUTANT_RUN_TIMEOUT_SECONDS` | No | API limit snapshot; defaults to 1800. |
| `TESTMUTANT_PER_TEST_TIMEOUT_SECONDS` | No | API limit snapshot; defaults to 60. |
| `TESTMUTANT_MAX_TESTS_PER_RUN` | No | API limit snapshot; defaults to 25. |
| `TESTMUTANT_MAX_ARTIFACT_SIZE_BYTES` | No | API limit snapshot; defaults to 52428800. |
| `TESTMUTANT_MAX_REPAIR_ATTEMPTS` | No | API limit snapshot; defaults to 2. |
| `TESTMUTANT_ENVIRONMENT_CONFIGURATION_ID` | No | Environment configuration id when available. |
| `TESTMUTANT_API_URL` | No | Callback API base URL; set this for local/container callbacks when the production default is not correct. |

Environment check jobs also require:

| Name | Required | Description |
| --- | --- | --- |
| `TESTMUTANT_ENVIRONMENT_CHECK_ID` | Yes | Environment check id receiving the result. |
| `TESTMUTANT_ENVIRONMENT_CHECK_TIMEOUT_SECONDS` | No | Check timeout; defaults to 30. |

## Packaging Assumptions

The package entrypoint is `dist/index.js`, and the npm `testmutant` bin points
to the same file. The package must include `dist/index.js` and `dist/action.js`
and must declare runtime dependencies for `commander`, `dotenv`, `ws`,
`playwright`, and `@playwright/test`.

Linux/container images need Node.js 20 or newer and Playwright Chromium
available before jobs run. Prefer installing browser assets at image build time:

```sh
npm ci --omit=dev
node node_modules/playwright/cli.js install --with-deps chromium
```

Windows/local development validates process invocation with `node
dist/index.js ...`; Linux/container validation additionally checks executable
mode on `dist/index.js`.
