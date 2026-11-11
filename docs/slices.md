# Public implementation slices

Each slice owns only the paths listed below. Existing shared files such as `adapters/manifest.json`, `adapters/plan-contract.json`, `runtime/core-protocol.json`, the Rust core, and the generic Node driver remain with the integrator. If a slice needs a shared protocol or driver change, send a proposed interface delta to the integrator; do not edit or co-own those files.

Every adapter is a `planVersion: 1` data plan. The Rust sans-IO core continues to use the JSON protocol; Node supplies generic effects. Provider-specific behavior belongs in adapter data, specifications, fixtures and tests; the host remains provider-neutral. Public relay acceptance uses public DoH, pins a public IP for TLS while retaining SNI hostname validation, and reports `remote:false` with `networkPath:"public-relay"`. A receipt proves the relay path, not execution from another client network.

## 1. ngrok

**Owned paths**

- `adapters/ngrok-https-edge.definition.json`
- `adapters/ngrok-tls-passthrough.definition.json`
- `adapters/ngrok-tcp-passthrough.definition.json`
- `test/adapters/ngrok-plans.test.mjs`
- `test/e2e/ngrok-public-relay.test.mjs`

**Interface satisfied:** Three planVersion 1 definitions use generic spawn, private-file materialization and owned-process effects. They preserve the declared transport. HTTPS edge termination may publish HTTPS after proof; TLS and TCP passthrough retain their transport and must not be represented as HTTPS. The shared JSON protocol/feature admission delta, if needed, goes to the integrator.

**Deterministic acceptance:** Run `node --test test/adapters/ngrok-plans.test.mjs`. Verify admission rejects missing private-config, transport-mapping or policy-inspection features before effects; credentials are never in argv, plan output or logs; and each mode rejects a mismatched transport or endpoint.

**Live acceptance:** The integrator's authorized live harness runs one configured endpoint at a time, verifies the exact hostname, TLS and instance challenge through pinned public DoH/IP, exercises MCP `tools/list`, `tools/call` and timed SSE, then stops only the owned agent and verifies its endpoint and unrelated routes remain intact. No endpoint, credential or account setting is created or changed by the leaf tests.

**Expect it to work because:** The plans bind each mode to generic private-file and owned-process effects, while mode-specific admission and transport assertions prevent the HTTPS edge behavior from being inferred for passthrough modes.

## 2. Cloudflare named tunnel

**Owned paths**

- `adapters/cloudflare-named.definition.json`
- `test/adapters/cloudflare-named-plan.test.mjs`
- `test/e2e/cloudflare-named-public-relay.test.mjs`

**Interface satisfied:** A planVersion 1 connector for an existing named tunnel and an already-routed hostname. It uses a generic private-file effect for the token and an owned-process effect for the connector. It does not provision a tunnel, DNS record or certificate and does not fall back to Quick Tunnel. Send any private-file-reference admission delta to the integrator.

**Deterministic acceptance:** Run `node --test test/adapters/cloudflare-named-plan.test.mjs`. Check missing private-file support rejects before spawn, token content never enters argv/output, the selected hostname and tunnel identity are exact, and stop targets only the recorded connector process.

**Live acceptance:** With an existing owner-configured tunnel, the integrator's live harness confirms pinned public DoH/IP TLS and instance proof, performs MCP list/call and timed SSE, then stops the connector and confirms the named tunnel, DNS, certificate and other connectors remain present.

**Expect it to work because:** The plan only starts an owned connector against an already-routed hostname and stores its token through the host's private-file effect; it leaves account and route lifecycle with their owner.

## 3. LAN

**Owned paths**

- `adapters/lan.definition.json`
- `adapters/specs/lan.md`
- `test/adapters/fixtures/lan-plan-cases.json`
- `test/adapters/lan-plan.test.mjs`
- `test/e2e/lan-client-vantage.test.mjs`

**Interface satisfied:** A planVersion 1 local-forwarder effect binds only the selected present interface and forwards to the loopback gate. It requires scoped firewall approval and client-proven name or address. HTTP is reported as HTTP unless separately configured client-trusted TLS is proven. Request a generic interface-forwarder or client-vantage protocol delta from the integrator if the existing interfaces do not express these facts.

**Deterministic acceptance:** Run `node --test test/adapters/lan-plan.test.mjs`. Verify loopback, stale interface, absent firewall receipt and unproven client address all block publication; the forwarder binds only the selected interface; stop closes only its listener; occupied or unrelated listeners remain untouched.

**Live acceptance:** A LAN peer performs the nonce and requested transport probes using the selected address/name and receives the expected instance; the integrator verifies the listener and firewall scope before and after stop. No global firewall rule is added or removed by acceptance.

**Expect it to work because:** The plan binds the exact selected interface and only advertises reach after peer-vantage proof, so a host-side address or loopback success cannot masquerade as LAN access.

## 4. Own address or domain

**Owned paths**

- `adapters/own-address.definition.json`
- `adapters/specs/own-address.md`
- `test/adapters/fixtures/own-address-plan-cases.json`
- `test/adapters/own-address-plan.test.mjs`
- `test/e2e/own-address-public-relay.test.mjs`

**Interface satisfied:** A validate-only planVersion 1 external-origin binding accepts an explicit credential-free HTTPS origin. It has no provider create/remove recipe. Health refreshes identity proof; an origin update requires a fresh binding and challenge and withdraws the prior generation. The published proof labels the public relay path `remote:false`. Propose any generation-withdrawal or probe-receipt delta to the integrator.

**Deterministic acceptance:** Run `node --test test/adapters/own-address-plan.test.mjs`. Verify non-HTTPS or credential-bearing origins reject, matching fresh nonce/TLS receipts publish only the exact origin, stale-generation updates fail closed, and stop performs no external route mutation.

**Live acceptance:** The integrator's live harness pins public DoH resolution to a public IP, validates SNI/TLS and the instance challenge, then runs MCP list/call and timed SSE through that origin. Confirm the route configuration is unchanged before and after validation and stop.

**Expect it to work because:** The plan only validates an owner-managed origin using a fresh identity challenge and makes no external route changes, so its proof is bounded to the exact configured address.

## 5. Tailnet-private

**Owned paths**

- `adapters/tailscale-private.definition.json`
- `adapters/specs/tailscale-private.md`
- `test/adapters/fixtures/tailscale-private-plan-cases.json`
- `test/adapters/tailscale-private-plan.test.mjs`
- `test/e2e/tailscale-private-client-vantage.test.mjs`

**Interface satisfied:** A planVersion 1 private Serve plan uses a verified unused listener, exact root mount, current profile identity and continuous ownership receipt. It preserves existing Serve/Funnel handlers and occupied ports. Probe vantage is tailnet-private, distinct from public relay. Any compare-and-swap or ownership-receipt protocol extension is proposed to the integrator.

**Deterministic acceptance:** Run `node --test test/adapters/tailscale-private-plan.test.mjs`. Verify missing HTTPS/MagicDNS prerequisites, unknown profile identity, occupied candidate ports and absent ownership continuity block create or cleanup; exact owned route removal succeeds while other handlers and ports remain unchanged.

**Live acceptance:** The integrator validates from a tailnet client with TLS, nonce and requested protocol probes, then stops the owned route and compares provider readback against the baseline. The check preserves protected ports 443 and 10000 and all occupied routes.

**Expect it to work because:** The plan scopes allocation and cleanup to one exact listener and route under a continuous identity receipt, while readback guards preserve unrelated provider state.

## 6. localhost.run trial fix: lifecycle handling

**Owned paths**

- `adapters/localhost-run.definition.json`
- `adapters/specs/localhost-run-trial.md`
- `test/adapters/fixtures/localhost-run-trial-cases.json`
- `test/adapters/localhost-run-trial-plan.test.mjs`
- `test/e2e/localhost-run-trial-lifecycle.test.mjs`

**Interface satisfied:** A planVersion 1 owned SSH child with isolated known_hosts, key-change rejection and bounded lifetime. The current public-relay path works and is the readiness gate. This slice adds URL-rotation and lifetime handling plus capture/correctness checks. Current acceptance includes a real tool call, timed SSE and cleanup.

**Deterministic acceptance:** Run `node --test test/adapters/localhost-run-trial-plan.test.mjs`. Simulate URL rotation, expiry, child exit, cancellation and changed host key. Check readiness never publishes a stale candidate, uncertain child ownership remains reconcilable, only private SSH artifacts are removed, and no user SSH config or known_hosts is modified.

**Live acceptance:** The integrator's live harness performs the current public-DoH/pinned-IP/SNI proof, MCP list/call, timed SSE, status and stop; it checks URL/lifetime handling and confirms zero owned residue with unrelated state preserved. Both localhost.run and Funnel have passed actual tool call, timed SSE and cleanup.

**Expect it to work because:** The live path already proves the trial relay end to end, and the new lifecycle cases exercise rotation and expiry while retaining the same readiness proof and owned-child cleanup rules.

## 7. Status and stop UX

**Owned paths**

- `packages/gozar-node/status-view.mjs`
- `packages/gozar-node/stop-view.mjs`
- `test/node/status-view.test.mjs`
- `test/node/stop-view.test.mjs`
- `test/e2e/status-stop-journey.test.mjs`

**Interface satisfied:** Read-only status renders session, exact endpoint, proof class, freshness, current capabilities and state with concrete next steps from existing controller receipts. Stop withdraws publication first, then reports cleanup, retained ownership or reconciliation needed. It delegates to the existing generic driver and does not mutate provider state outside the owned plan. Propose any status/stop JSON protocol fields to the integrator.

**Deterministic acceptance:** Run the three listed Node test files. Drive ready, expired, stale-generation, stopping, cleanup-pending and stopped fixtures through the actual CLI/view boundary. Confirm output is stable, contains no secrets, and stop only signals matching owned process/route handles.

**Live acceptance:** The integrator runs status, stop and status against a disposable authorized live route; it verifies publication withdrawal precedes cleanup, unrelated routes survive, and final state accurately reports zero residue or explicit reconciliation.

**Expect it to work because:** The views consume existing session and ownership receipts, so displayed state follows the same durable lifecycle record that gates publication and cleanup.

## 8. Client-profile data pack

**Owned paths**

- `adapters/client-profiles/manifest.json`
- `adapters/client-profiles/mcp-client-profile.schema.json`
- `adapters/client-profiles/profiles/claude-desktop.json`
- `adapters/client-profiles/profiles/claude-ai.json`
- `adapters/client-profiles/profiles/chatgpt-web.json`
- `adapters/client-profiles/profiles/codex.json`
- `adapters/client-profiles/profiles/cursor.json`
- `test/adapters/client-profile-pack.test.mjs`

**Interface satisfied:** Versioned data records for client transport and capability expectations. Each profile distinguishes supported configuration shape from observed reachability; adapter planVersion 1 remains the route contract and the shared JSON protocol remains unchanged. If a consumer needs a new negotiated capability, propose it to the integrator rather than extending the core here.

**Deterministic acceptance:** Run `node --test test/adapters/client-profile-pack.test.mjs`. Validate every record against the schema, reject duplicate identifiers and unknown fields, and check profile capability claims are evidence-backed and do not promote a candidate without a matching probe receipt.

**Live acceptance:** For each supported profile, the integrator configures a disposable endpoint using documented settings and runs the client's MCP call and requested streaming behavior over the selected network path, recording positive results and version. Profiles remain data-only; acceptance does not rewrite user configuration.

**Expect it to work because:** The pack separates stable client configuration facts from per-route proof, and schema plus probe gates prevent profile metadata from claiming reachability on its own.
