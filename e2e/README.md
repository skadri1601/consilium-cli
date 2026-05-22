# CLI E2E smoke tests

End-to-end smoke tests that spawn the built `dist/index.js` binary as a real
child process and drive it against an in-memory HTTP mock. No backend is
required.

## Run

```bash
pnpm --filter @myconsilium/cli build           # ensure dist/index.js exists
pnpm --filter @myconsilium/cli test:e2e        # run the suite
```

A global setup hook (`helpers/global-setup.ts`) auto-builds the CLI if
`dist/index.js` is missing, so a single `pnpm --filter @myconsilium/cli test:e2e`
invocation is enough in CI.

## Layout

- `helpers/spawn-cli.ts` — spawn the CLI with an isolated `HOME` (tmpdir under
  `os.tmpdir()`), a custom `CONSILIUM_API_URL`, and optional seeded auth
  config. Returns `{ code, stdout, stderr, homeDir }`.
- `helpers/mock-api.ts` — `node:http` server with canned responses for
  `/api/v1/auth/me`, `/api/v1/users/me`, `/api/v1/users/me/preferences`,
  `/api/v1/auth/cli-tokens`, `/api/v1/debates`,
  `/api/v1/debates/<id>/stream` (SSE), `/api/v1/deliberation`,
  `/api/v1/deliberation/<id>/stream` (SSE) and
  `/api/v1/sessions/<id>/share`. Custom routes can be added via
  `handle.setRoute(method, pathOrRegex, handler)`.
- `helpers/global-setup.ts` — builds `dist/` once before the suite runs if
  the artifact is missing.
- `smoke.test.ts` — one `describe` block with the test cases.
- `vitest.config.ts` — separate config: longer timeouts, single-threaded
  pool, isolation on, no coverage.

## Conventions

- Each test gets its own tmpdir HOME — there is no shared state. The
  `afterEach` hook cleans every tmpdir and resets `api.requests`.
- The CLI is invoked via `process.execPath` (the same Node binary running
  Vitest) plus `dist/index.js` — no global install required.
- The mock auto-seeds an `apiKey` so `requireAuth()` succeeds without an
  interactive login prompt. Pass `seedAuth: false` to `runCli` to test the
  unauth path.
