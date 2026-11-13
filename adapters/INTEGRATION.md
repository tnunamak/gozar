# Adapter authoring

A provider is one directory under `adapters/providers/<id>/` and one entry in the `providers` list of `adapters/manifest.json`. Nothing else in Gozar names it: the catalog, the CLI, the docs and the package list read the registry.

```json
{ "id": "example-edge", "module": "providers/example-edge/index.mjs", "definition": "providers/example-edge/definition.json" }
```

- `definition.json` is `{ "adapter": AdapterDefinition }`, optionally with `"wraps"` naming an existing recipe record (`adapters/<id>.definition.json`). The definition states the provider's reach, address stability, cost, who can read traffic, supported usage kinds (`session`, `attached`, `durable`), protocol checks (`sse`, `streamableHttp`, `oauthDcr`) and its disclosure text. A claim that Gozar has not proved with a live check stays `false` or `unknown`; evidence goes in the definition.
- `index.mjs` default-exports the adapter. A recipe-based provider returns `recipeAdapter({ definition })` from `packages/gozar-node/adapter-runtime.mjs`; a provider with its own protocol implements `detect`, `properties`, `setupActions`, `setup`, `plan`, `create`, `observe`, `verify`, `remove` and `runtimeFacts` against the contexts declared in `packages/gozar-node/adapter-contract.d.ts`. A `create` receipt carries the `origin` the provider allocated, or `null`; Gozar reads the published origin from it.
- An adapter decides its own platform support through `ctx.platform`. Gozar 0.2.0 supports Linux and macOS; on any other value the core answers `unsupported` for every candidate before an adapter runs. An adapter whose commands only work on one supported platform answers `unsupported` for the other, with a comment that says why.
- Run `node scripts/sync-adapter-registry.mjs` after you edit `providers`. It regenerates the compatibility arrays `definitions` and `normalizedDefinitions` and fails when a listed file is missing. Run `node scripts/generate-adapter-docs.mjs` to refresh `docs/providers.md`. Both accept `--check`, and `test/node/provider-agnostic.test.mjs` runs both checks.
- `loadAdapters({ manifest, root })` accepts another manifest. A test adds a fake provider through a manifest of its own and needs no core edit; `test/node/public-api-journey.test.mjs` does this.
- `scripts/check-package.mjs` requires every registry module and definition to be in the packed file list.

Legacy: `manifest.json` also lists the older `planVersion:1` recipe records that the session path and `operationalCatalog` still use. The current catalog selects localhost.run trials, Funnel, private Serve, LAN HTTP and owner-managed HTTPS validation. The remaining modes use detection records until separately admitted.

Each definition supplies its identifier, audience, ownership, capability requirements, user actions, typed bindings and recipes. The core and host both check `admission.requiredFeatures` before a plan executes. Unknown operations, bindings or recipe fields reject the whole plan.

## Recipes and observations

An operation contains ordered `before` observations, `requires` predicates, execution and `after` readback. The runtime emits an exact `recipeRef` for each step. Observation completions include fresh, session-scoped authority metadata. Only declared typed captures survive into state; raw provider output stays transient and bounded.

JSON document predicates support `all`, `equals`, `exists` and `not`. JSON pointers support escaped tokens and wildcard traversal over maps or arrays. Use raw record equality before selective capture when additional handlers or fields would change the meaning of a route. Wildcard equality is existential. For each selected TCP and Web record, add a required whole-record capture to enforce exactly one match, including records that omit captured leaves. Both Serve and Funnel use `selectedListener` and `selectedWeb` record captures with empty `fields`; these retain no raw provider data.

Executable recipes use typed direct argv. Keep credentials behind private handles and preserve transport distinctions such as HTTPS termination versus TLS passthrough. The host checks the expanded payload against the exact admitted recipe and acknowledged durable intent.

## Ownership and cleanup

Record an immutable handle, continuity reference, original generation, resource details and original bindings. An owned process uses its process birth identity as well as its PID. The runtime checks continuity before removal and compares live provider records before route cleanup.

Funnel allocates only a freshly checked unused 8443 listener and preserves protected 443/10000 and all occupied routes. Private Serve plans select from explicitly declared unused candidates. Root mounts use dedicated listeners. Stop signals only the owned foreground child and checks that its selected listener is absent. The live harness compares the full configuration with its baseline.

An `external-owned` address uses validation and health checks. Its lifecycle preserves the owner-managed route. Origin updates require a fresh binding and challenge and withdraw the prior generation.

## Address proof

The public-relay verifier resolves the hostname with public DNS over HTTPS, rejects nonpublic addresses, pins the connection IP and validates TLS against the original hostname. A nonce-bound identity and timed stream establish the instance and incremental delivery. Receipts bind the exact origin, session challenge, vantage and expiry.

The live harness separately exercises a declared read-only MCP test tool and a timed service stream through the same public IP. This keeps product tool knowledge out of the generic host.

Run adapter checks with:

```sh
nice -n 19 ionice -c3 node --test --test-concurrency=2 test/adapters/*.test.mjs
```

The fixtures are synthetic examples using documentation addresses and example hostnames. Deterministic checks cover admission, parsing, sequencing and ownership; the [live harness](../harness/README.md) exercises enabled routes and cleanup.

## Drop-1 private, LAN and owner-managed addresses

Private Serve uses the same foreground-process ownership contract as Funnel. It selects only 9444 or 9445 after reading every top-level and foreground TCP, Web and AllowFunnel map. Port 9443 is never a candidate. Preserve 443, 10000 and every occupied listener. Use the root mount on the selected dedicated port. Never add public visibility to a private listener: Funnel visibility applies to the entire host and port.

Capture the actual node ID, DNS suffix and DNS name from status. The tailnet StableID is not captured: Tailscale 1.102.5 does not report it, and the node ID plus the DNS suffix already name this node on this tailnet. Status does not supply a native current profile ID. Check Running, MagicDNS, the HTTPS capability and exact certificate-domain eligibility before startup. The private plan does not require Funnel permission. Capability names come from the existing source-backed Funnel record, not remembered spellings. Certificate-domain eligibility permits provisioning; only the TLS probe proves that the client trusts the certificate. `--yes` does not prove feature setup cannot prompt. Closed stdin and bounded startup prevent an unattended prompt from becoming unbounded work.

Private creation reads back the exact foreground HTTPS and root proxy records and rejects any Funnel entry for that address. Stop inspects the original child handle and process birth identity, checks the node and tailnet fingerprint, signals only that child, and checks that the selected listener is absent. It never runs provider `off` or `reset`. A remaining mapping is cleanup debt. The JSON wildcard predicates match values; they do not provide a provider transaction or an exclusive owner marker. A matching record alone cannot establish ownership.

LAN creation requires two exact, fresh host facts with the current session and generation:

| Fact | Exact value |
| --- | --- |
| `selected-interface-still-present` | `{ "address": "{interfaceAddress}" }` |
| `firewall-user-approved` | `{ "bindAddress": "{interfaceAddress}", "port": 0, "targetHost": "127.0.0.1", "targetPort": "{gatePort}", "scheme": "http" }` |

Port zero requests an OS-assigned port. Firewall consent covers that ephemeral listener on the selected interface and exact loopback target; it does not claim a fixed port rule exists. The host must make this scope explicit. A missing or different scope blocks allocation. The forwarder owns its listener and forwards to the loopback gate. Client reachability cannot be proven before that listener exists. After creation, an exact-origin nonce and requested-protocol probe from a real LAN peer gates publication. A local fetch cannot supply that receipt. The current plan advertises its explicit interface IP; it does not infer a client-resolvable name from the host name. This plan provides HTTP. HTTPS-required clients are denied. A separate TLS listener needs its own admitted plan and client trust proof.

An owner-managed address supplies `externalOrigin` as a credential-free HTTPS origin. Its data sets `setup.requiresProxyTarget:true`. The Node controller must first return an external Action with the exact `gateTarget`, let the owner configure the existing proxy, and wait without probing. `gozar health --port N` resumes validation. This setup flag controls the host workflow; it does not grant core create or delete authority. TLS, the current instance challenge and each requested protocol must pass before exact-origin approval. Health refresh and origin rotation use a new challenge, withdraw prior publication and require new approval. Expiry withdraws readiness. Stop withdraws local publication and leaves the external route intact.

## Evidence boundaries

[Generated-WASM traces](evidence/drop1-wasm-traces.json) record actual interpreter outputs for the first five plans, occupied-port denial, private visibility readback denial, LAN scope denial, peer-proof denial, instance mismatch, broken ownership continuity and duplicate whole records with missing HTTPS or Proxy leaves in both Serve and Funnel. All completions in those traces are synthetic. They prove data admission and interpreter sequencing only. They establish no live ownership, DNS authority, certificate issuance, outside reach or provider cleanup.

Regenerate the named trace file against the final core artifact with:

```sh
GOZAR_ADAPTER_TRACE_OUTPUT=adapters/evidence/drop1-wasm-traces.json nice -n 19 ionice -c3 node --test --test-concurrency=2 test/adapters/plan.test.mjs
nice -n 19 ionice -c3 node --test --test-concurrency=2 test/adapters/*.test.mjs
```

The trace includes hashes of the WASM module, JavaScript bindings and each covered plan. If any of these changes, regenerate it. The pinned [Tailscale report](evidence/tailscale-serve-funnel-source-facts.md) establishes command and configuration semantics. The [cloudflared report](evidence/cloudflared-named-tunnel-source-facts.md) establishes why a token or startup message cannot prove DNS authority or the configured origin. Neither report supplies runtime evidence.
