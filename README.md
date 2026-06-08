# TestMutant CLI

Command-line tools for using TestMutant locally and in CI.

## Requirements

- Node.js 20 or newer
- A TestMutant API key

## Installation

Run the CLI without installing it globally:

```sh
npx @testmutant/cli --help
```

Or install it globally:

```sh
npm install -g @testmutant/cli
testmutant ping
```

## Configuration

The CLI reads configuration from environment variables or command-line flags.

| Environment variable | Flag | Description |
| --- | --- | --- |
| `TESTMUTANT_API_KEY` | `--api-key <key>` | TestMutant API key used to authenticate requests. |
| `TESTMUTANT_API_URL` | `--api-url <url>` | TestMutant API base URL. Defaults to `http://localhost:5086`. |
| `TESTMUTANT_REPOSITORY_PROVIDER` | | Optional repository provider override for `testmutant ci`. |
| `TESTMUTANT_REPOSITORY_FULL_NAME` | | Optional repository full name override for `testmutant ci`. |
| `TESTMUTANT_BASE_URL` | | Optional environment URL recorded by `testmutant ci`. |
| `TESTMUTANT_ENVIRONMENT` | | Optional environment name recorded by `testmutant ci`. |
| | `--timeout <ms>` | API request timeout in milliseconds. Defaults to `30000`. |
| | `--json` | Print command output as JSON. |

You can also put environment variables in a `.env` file in the directory where
you run the CLI:

```env
TESTMUTANT_API_KEY=tm_key_...
TESTMUTANT_API_URL=http://localhost:5086
```

## Local Usage

Verify that the CLI can connect to TestMutant:

```sh
TESTMUTANT_API_KEY=tm_key_... testmutant ping
```

Use a non-default API URL:

```sh
TESTMUTANT_API_KEY=tm_key_... TESTMUTANT_API_URL=https://api.example.com testmutant ping
```

Pass configuration directly as flags:

```sh
testmutant --api-key tm_key_... --api-url http://localhost:5086 ping
```

Print machine-readable output:

```sh
testmutant --json ping
```

## CI Usage

Store `TESTMUTANT_API_KEY` as a secret in your CI provider. Pass the deployed
or preview application URL as the positional `ci` argument, or use
`--base-url`.
Example GitHub Actions step:

```yaml
permissions:
  contents: read

jobs:
  testmutant:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v5

      - name: Run TestMutant
        uses: TestMutant/cli@alpha
        with:
          mode: Advisory
          base_url: https://preview.example.com
        env:
          TESTMUTANT_API_KEY: ${{ secrets.TESTMUTANT_API_KEY }}
```

## Commands

### `testmutant ping`

Verifies that the CLI can authenticate with the TestMutant API and prints the
connected organization and CLI API version.

### `testmutant ci`

Detects repository, branch, commit, and CI provider metadata, creates a
TestMutant run, executes any Playwright tests returned by the API against the
provided base URL, completes the run with pass/fail results, and prints the run
id, status, and test counts.

```sh
testmutant ci https://preview.example.com
testmutant ci --base-url https://preview.example.com
testmutant ci --mode Enforce https://preview.example.com
```

Generated Playwright tests run with the CLI-managed Playwright runtime. In
`Enforce` mode, failed generated tests are reported to the API before the CLI
exits with a nonzero status.

## License

MIT. Copyright (c) 2026 Sleepycat Software LLC.
