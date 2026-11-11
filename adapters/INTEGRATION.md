# Adapter authoring

Adapters are wrapped `planVersion:1` data records. `manifest.json` enumerates definitions; `operationalCatalog` selects the enabled operational plans. The current catalog enables localhost.run trials and Funnel, and inventories the remaining modes through detection records.

Each definition supplies its identifier, audience, ownership, capability requirements, user actions, typed bindings and recipes. The core and host both check `admission.requiredFeatures` before a plan executes. Unknown operations, bindings or recipe fields reject the whole plan.

## Recipes and observations

An operation contains ordered `before` observations, `requires` predicates, execution and `after` readback. The runtime emits an exact `recipeRef` for each step. Observation completions include fresh, session-scoped authority metadata. Only declared typed captures survive into state; raw provider output stays transient and bounded.

JSON document predicates support `all`, `equals`, `exists` and `not`. JSON pointers support escaped tokens and wildcard traversal over maps or arrays. Use raw record equality before selective capture when additional handlers or fields would change the meaning of a route.

Executable recipes use typed direct argv. Keep credentials behind private handles and preserve transport distinctions such as HTTPS termination versus TLS passthrough. The host checks the expanded payload against the exact admitted recipe and acknowledged durable intent.

## Ownership and cleanup

Record an immutable handle, continuity reference, original generation, resource details and original bindings. An owned process uses its process birth identity as well as its PID. The runtime checks continuity before removal and compares live provider records before route cleanup.

Funnel allocates only a freshly checked unused 8443 listener and preserves protected 443/10000 and all occupied routes. Private Serve plans select from explicitly declared unused candidates. Root mounts use dedicated listeners. Stop signals only the owned foreground child and checks the resulting configuration against the baseline.

An `external-owned` address uses validation and health checks. Its lifecycle preserves the owner-managed route. Origin updates require a fresh binding and challenge and withdraw the prior generation.

## Address proof

The public-relay verifier resolves the hostname with public DNS over HTTPS, rejects nonpublic addresses, pins the connection IP and validates TLS against the original hostname. A nonce-bound identity and timed stream establish the instance and incremental delivery. Receipts bind the exact origin, session challenge, vantage and expiry.

The live harness separately exercises a declared read-only MCP test tool and a timed service stream through the same public IP. This keeps product tool knowledge out of the generic host.

Run adapter checks with:

```sh
node --test test/adapters/*.test.mjs
```

The fixtures are synthetic examples using documentation addresses and example hostnames. Deterministic checks cover admission, parsing, sequencing and ownership; the [live harness](../harness/README.md) exercises enabled routes and cleanup.
