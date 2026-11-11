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
node harness/drop1a.mjs --route own-address --independent-ingress --proof-class public-relay --report ./own-address-report.json
```

The harness checks publication, the accepted receipt, pinned-path MCP/SSE, status and stop. Cleanup checks the owned resource ledger and process identities, preserves unrelated routes, and checks that an unrelated child survives stop. Every live entry point shares an exclusive lock. Each run takes a fresh full Tailscale baseline under that lock and compares it after cleanup, including failure paths. Funnel uses only unused 8443. Private Serve uses the first unused port from 9444 and 9445; existing configuration is never reset or restored wholesale.

The own-address check creates a disposable ingress independently of Gozar using the trial recipe. Gozar receives only its HTTPS origin. After `expose` returns the explicit external action, the harness acts as the ingress owner: it points the fixture at the exact gate target and calls `health`. For a real owner-managed address, **you must configure your existing reverse proxy to that printed target, then run `gozar health --port N`**. Validation and stop must preserve the independent process, target, known-hosts file and origin. After stop, the fixture owner reconnects its service and verifies another pinned MCP call and stream before removing its own fixture. No account or DNS provisioning occurs.

To record the actual first-run terminal journey with the standalone echo demo, run:

```sh
node harness/cli-walk.mjs --work-directory "$PRIVATE_AUDIT/no-flag-walk"
```

This invokes exactly `node bin/gozar.mjs expose --port N` in a terminal, answers `internet` and `yes` only when prompted, and records the raw transcript, pinned public proof, status, stop and baseline comparison. It does not select a provider through flags.

## Genuine private and LAN peers

The same live harness accepts `tailscale-private` and `lan` with `--proof-class remote-executor`, `--executor-id ID`, a retained `--work-directory`, and `--cli-options FILE`. The JSON options file must select that run's exact `private-probes` directory with `--probe-directory` and the trusted executor identity with `--probe-executor-id`. LAN additionally needs `--bind-address IP --firewall-ack IP`; this is an explicit scoped approval, never a firewall mutation. LAN uses HTTP; HTTPS-required clients remain blocked.

On `outside-challenge-ready`, execute the sanitized `outside-probe.mjs` on the actual appropriate peer. The coordinator must authenticate the machine, its tailnet/LAN membership and actual execution provenance, wrap the real observations with its job identity and measured receipt, then use `sign-outside-receipt.mjs` locally. Local requests, namespaces and requests to the host's interface IP are not remote peer evidence. Public and tailnet observations require trusted TLS. Only explicit LAN HTTP requirements permit a receipt with `tls:false`.

Without an appropriate peer, leave private and LAN live gates blocked. The minimal next action is to identify a reachable machine on the intended network and arrange trusted execution there. Public-relay proofs cannot substitute for either gate.

Temporary files use `GOZAR_TEST_TMPDIR`, or `~/.cache/gozar/tests` by default. Use `--work-directory PATH` to retain run artifacts. Reports include raw CLI arguments and results; keep them private if they contain information about your environment.

Exit `0` means the selected checks and cleanup passed; `1` means failure. The inspection command can return `2` when a route needs validation. A failed route remains failed when cleanup succeeds.

When a failed or degraded CLI result has a candidate URL, the harness records a read-only diagnostic through the pinned public transport before cleanup. Diagnostic responses do not approve publication.

## External verifier helpers

`make-outside-probe.mjs` bundles a restricted observer request using Node built-ins. `sign-outside-receipt.mjs` reads the exact adjacent private key locally and checks file ownership, mode and symlinks. Private keys, key paths and private request IDs stay outside the observer payload. These helpers support explicit external verification; the default public relay command uses the host transport described above.
