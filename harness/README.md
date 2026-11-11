# Executable harness

Run these commands from the repository root with Node 22+ and the generated WASM. Build the WASM with `bash scripts/build-wasm.sh` first.

```sh
node --test --test-concurrency=2 test/e2e/*.test.mjs
node harness/run.mjs --fake-effects
node harness/run.mjs --inspect
```

The suite covers the real WASM, Controller/EffectDriver, local HTTP/TLS, MCP tool calls, timed SSE, controlled child processes and loopback forwarders. Synthetic core completions and receipt validators use fixtures.

## Echo demo server

Start a local MCP server with one `echo` tool:

```sh
node harness/dummy-server.mjs --port 18765
```

The server prints its port and URL once. Use that URL or append `/mcp` in a Streamable HTTP client. Call `echo` with `{"echo":"hello"}`. Both paths support MCP requests and SSE; opening the root URL in a browser shows the instance identity. Press Ctrl+C to stop.

## Public relay checks

The default public relay gate resolves DNS through a pinned public resolver, connects HTTPS to the resolved public IP and validates the original hostname. It checks the fresh instance nonce and incremental SSE delivery. Private, loopback, CGNAT, reserved and special-use addresses fail closed.

The receipt records `networkPath:"public-relay"`, `remote:false` and `publicDns:true`. The issued challenge must allow this proof class. This checks the public relay path from the host; a separate client network has its own reachability conditions.

The harness uses the same pinned transport for `tools/list`, a `tools/call` that returns the fresh instance nonce and echo challenge, and two MCP SSE events. Server event spacing must be at least 150 ms and receive spacing at least 100 ms.

## Live route checks

Live commands create a route through the CLI and stop it after the checks. Run one route at a time with the required provider installed and authenticated:

```sh
node harness/drop1a.mjs --route localhost-run --proof-class public-relay --report ./localhost-run-report.json
node harness/drop1a.mjs --route tailscale-funnel --proof-class public-relay --report ./funnel-report.json
```

The harness checks publication, the accepted receipt, pinned-path MCP/SSE, status and stop. Cleanup checks the owned resource ledger and process identities, preserves unrelated routes, and checks that an unrelated child survives stop. A lock prevents overlapping trials. Funnel uses port 8443 only after checking that it is free.

Temporary files use `GOZAR_TEST_TMPDIR`, or `~/.cache/gozar/tests` by default. Use `--work-directory PATH` to retain run artifacts. Reports include raw CLI arguments and results; keep them private if they contain information about your environment.

Exit `0` means the selected checks and cleanup passed; `1` means failure. The inspection command can return `2` when a route needs validation. A failed route remains failed when cleanup succeeds.

When a failed or degraded CLI result has a candidate URL, the harness records a read-only diagnostic through the pinned public transport before cleanup. Diagnostic responses do not approve publication.

## External verifier helpers

`make-outside-probe.mjs` bundles a restricted observer request using Node built-ins. `sign-outside-receipt.mjs` reads the exact adjacent private key locally and checks file ownership, mode and symlinks. Private keys, key paths and private request IDs stay outside the observer payload. These helpers support explicit external verification; the default public relay command uses the host transport described above.
