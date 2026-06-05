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

Store `TESTMUTANT_API_KEY` as a secret in your CI provider. 
Example GitHub Actions step:

```yaml
- name: Verify TestMutant connection
  run: npx @testmutant/cli --json ping
  env:
    TESTMUTANT_API_KEY: ${{ secrets.TESTMUTANT_API_KEY }}
```

## Commands

### `testmutant ping`

Verifies that the CLI can authenticate with the TestMutant API and prints the
connected organization and CLI API version.

## License

MIT. Copyright (c) 2026 Sleepycat Software LLC.
