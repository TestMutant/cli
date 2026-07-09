# Internal Runner Service

`testmutant runner-service` starts the internal HTTP Playwright runner service.
The TestMutant API calls this service directly over internal HTTP. The service
does not poll for jobs, call LLMs, or call the TestMutant API on the main path.

## Run Locally

```sh
npm run build
node dist/index.js runner-service --port 8080 --token dev-runner-token
```

## Environment

| Name | Default |
| --- | --- |
| `TESTMUTANT_RUNNER_HOST` | `0.0.0.0` |
| `TESTMUTANT_RUNNER_PORT` | `8080` |
| `TESTMUTANT_RUNNER_TOKEN` | unset, local no-token mode |
| `TESTMUTANT_RUNNER_INSTANCE_ID` | generated local id |
| `TESTMUTANT_RUNNER_ARTIFACT_DIR` | OS temp `testmutant-runner-artifacts` |
| `TESTMUTANT_RUNNER_MAX_SESSIONS` | `1` |
| `TESTMUTANT_RUNNER_SESSION_TIMEOUT_MS` | `1800000` |
| `TESTMUTANT_RUNNER_HEADLESS` | `true` |

When `TESTMUTANT_RUNNER_TOKEN` is configured, every `/v1` route and `/healthz`
requires `Authorization: Bearer <token>`.

## Endpoints

- `GET /healthz`
- `POST /v1/sessions`
- `DELETE /v1/sessions/:sessionId`
- `POST /v1/sessions/:sessionId/navigate`
- `POST /v1/sessions/:sessionId/snapshot`
- `POST /v1/sessions/:sessionId/click`
- `POST /v1/sessions/:sessionId/fill`
- `POST /v1/sessions/:sessionId/press`
- `POST /v1/sessions/:sessionId/select`
- `POST /v1/sessions/:sessionId/check`
- `POST /v1/sessions/:sessionId/screenshot`
- `POST /v1/sessions/:sessionId/console`
- `POST /v1/sessions/:sessionId/network`
- `POST /v1/sessions/:sessionId/validate-draft`
- `POST /v1/execute-tests`

The OpenAPI schema anchor in the API is `/api/runner/v1/...`; the actual runner
service paths are `/v1/...` plus `/healthz`.

## API Configuration Example

```yaml
RunnerPool:
  Mode: ConfiguredHttp
  InternalToken: dev-runner-token
  Runners:
    - RunnerInstanceId: local-runner-1
      BaseUrl: http://localhost:8080
      Capabilities:
        - browser.chromium
        - playwright
        - browser.session
        - draft.validation
      MaxConcurrentSessions: 1
```

Artifacts are written to runner-local paths. Use a shared volume for the API to
read those paths, or add a future artifact transfer path before deploying the
runner in a separate container without shared storage.
