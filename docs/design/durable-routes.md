# Design: durable routes and route adoption

Status: proposal, revision 3 (after the first design review, plus the visibility rule). No code yet. Targets Gozar 0.2.0.

## Problem

Gozar can do two things today:

| | Gozar creates the route | The owner creates the route |
|---|---|---|
| **Temporary** | Sessions: `expose`, `status`, `stop`. Consent, a loopback gate, public-relay proof, a lifetime (default 15 min), teardown. | — |
| **Durable** | **Missing** | Service routes: `addService`, `statusServices`, `removeService`. A record of an HTTPS origin that the owner runs, verified by an in-app challenge. Gozar creates nothing. |

Some clients store an address and depend on it for a long time:
- an invitation that signs the host's origin, so members reject any other origin;
- an OAuth client registration or a hosted connector (for example a chat assistant's custom MCP server), where the URL is configured at the client side;
- a bridge that workers reach for days.

Such an app needs Gozar to **create** a route, **keep the same origin** across app restarts and host reboots, and **never publish a different origin** for that route. Today each app writes its own provider code for this (Tailscale `serve --bg` rules, ngrok reserved domains). That code repeats the ownership, verification and cleanup rules Gozar already has.

A second need: an app that already created such a route before it adopted Gozar must hand it to Gozar **without tearing it down**, because teardown and re-creation can change the origin and always causes a gap.

## Prior art

Summary of public research (2026-11-12):
- Tailscale `serve --bg` configuration persists until disabled and resumes after reboot. Foreground Serve ends with its session. Background config is shared by every app on the node and has ETag concurrency but no per-app ownership. Safe controllers read, compare and change only their own listener.
- tsnet apps (golink, tclip, tsidp), Syncthing (Device ID vs announced addresses) and embedded ngrok (account-owned reserved domain vs per-process endpoint) all separate a **durable identity** from a **replaceable route**. A reconnect callback or a returned URL is not proof that clients can reach the service.
- Idle limits differ by layer: ngrok HTTP 5 min, Syncthing relays 2 min, tunnl.gg about 121 s.
- Multi-provider tunnel libraries (LumeWeb tunneler, ToGO, Varin) expose `start/ready/stop`. None of them pins an origin or adopts an existing route.

## Proposal

### Route identity

A durable route has an app-chosen **route ID** (for example `coordinator`), unique within a Gozar home. The route ID, not the origin, is the identity: before the first publication there is no origin yet, and after it the origin must never change.

Durable records live next to service routes in the same home, one 0600 record per route ID, and carry `ownership`:
- `external-owned`: today's service route. Unchanged.
- `gozar-owned`: **new.** Gozar created or adopted the provider route and owns its removal.

`statusServices` lists both kinds, so a host has one place to ask "which long-lived routes exist". `removeService` refuses a `gozar-owned` record and names `releaseRoute`, so a record can never be deleted while its provider route stays live.

### Reservations

One home-wide **reservation lock** serializes every allocation that can collide: sessions (`expose`), `ensureRoute`, `adoptRoute` and `releaseRoute`. Under it, Gozar keeps a reservation table of `{listener target}` and `{adapter, provider resource}` (for Tailscale: node and HTTPS port). A caller takes the lock **before** it scans the provider and holds it through commit. Per-origin locks are not enough, because two routes with different origins can still claim the same listener or provider port.

### API (Node, `@tnunamak/gozar/service`)

```js
// Create the route, or reuse the one this record owns. Idempotent.
await ensureRoute({
  routeId,            // app-chosen, stable
  owner,              // app name shown to the user, for example 'faravan'
  adapterId,          // 'tailscale-funnel' | 'tailscale-private' | later 'ngrok-https-edge'
  target,             // '127.0.0.1:PORT' — the app's own listener
  origin,             // optional; see "Resolution"
  approvals,          // ordered list of approved tuples; see "Consent"
  home,
});
// -> { schemaVersion: 1, route: { routeId, owner, createdAt, origin, target, adapterId, ownership: 'gozar-owned',
//      lifetime: 'provider-persistent' | 'host-supervised', state, verification } }

await adoptRoute({ routeId, adapterId, target, origin, claim, handover, approvals, home }); // see "Adoption"
await releaseRoute({ routeId, mode: 'remove' | 'hand-back', home });
await statusServices({ home });   // re-observes and re-verifies; never trusts saved readiness
```

The app verifies with the existing `createServiceVerifier()` in its own request handler. **No Gozar gate process sits in the data path** of a durable route. The provider forwards straight to the app's listener, so Host and the provider's forwarding headers reach the app unchanged.

### Resolution: the record is authoritative

`ensureRoute` takes the reservation lock, then loads the record for `routeId` **before** it computes any candidate or chooses a port.
- **No record:** this is a first allocation. `origin` may be absent. Adapter fallback is allowed (see "Consent").
- **Record exists:** the record's origin and adapter are the pin. A caller `origin` that differs is refused. An absent `origin` means "the recorded one", never "unpinned". A different `adapterId` is refused.
- **Record in `lost`, `address_changed`, `uncertain` or `releasing`:** never treated as a new allocation. `lost` may be restored at the pinned origin (below); the other states need `releaseRoute` or `adoptRoute` first.

After every await, the call re-reads the record generation and stops if a concurrent `releaseRoute` moved it to `releasing`. A late create or verification can never re-publish a released route.

### Lifetimes

An adapter declares how its durable route lives:
- `provider-persistent`: the provider keeps the route without a process, for example Tailscale `serve --bg` / `funnel --bg`. The route survives app exit and reboot. Removal is an explicit provider command.
- `host-supervised`: the route exists only while a process runs, for example an ngrok agent. The embedding app keeps that process alive by calling `ensureRoute` on start. Gozar re-creates the process and requires the **same origin** back.

**Durable routes have no finite lifetime in 0.2.0.** A host-set expiry on a `provider-persistent` route has no enforcer: if no Gozar call runs after the deadline, the route stays reachable indefinitely. So `ensureRoute` rejects `lifetimeMs` unless the adapter declares a provider-enforced deadline (no current adapter does). Exposure for a bounded time stays with sessions, which own a live process and a timer. A later version may add expiry with an independent, persistent owner (for example a systemd timer) and an absolute `expiresAt` that reuse can never extend.

An adapter can offer a durable route only if it declares `addressStability: 'stable'`, meaning the same inputs give the same origin. Anonymous localhost.run fails this. So does any relay that assigns random names. Such adapters stay session-only.

### States

`creating → usable → (lost | address_changed) → releasing → released`, plus `uncertain`.

- `lost`: the provider route is absent. Gozar does **not** re-create it on its own. The host decides, normally by calling `ensureRoute` on start. That restores the route only if the result would have the pinned origin.
- `address_changed`: the provider would give, or gives, a different origin. **Terminal for publication.** Gozar never reports the new origin as the route's origin. The host must release, then create a new route with new consent.
- `uncertain`: Gozar saved its intent but cannot prove it made the mutation (see below). Not owned. Reported as cleanup debt.

### Pinned origin fails closed

1. Before any mutation, the adapter's plan computes the candidate origin from fresh observations (Tailscale: node DNS name + selected HTTPS port; ngrok: requested reserved domain). If the record pins an origin and the candidate differs, stop with `address_changed`. Mutate nothing.
2. After mutation, read back the provider config and compare it with the exact recorded rule. Then verify through the challenge from the controller vantage. If the observed origin differs, remove what this call created (when ownership continuity holds) and stop with `address_changed`.
3. Provider fallback (for example Funnel not permitted, so try ngrok) is allowed **only on a first allocation**. A pinned route never changes adapter.

### Consent

- The host collects approval of exact tuples `{adapterId, target, origin|null, durable:true}` and passes them as `approvals`, in the order it allows them. Gozar uses a tuple only if it is in that list. **Fallback to another adapter needs its own approved tuple**; the first adapter's approval never covers it.
- The record stores the tuple it was created under. A later `ensureRoute` with an identical tuple reuses that consent. Any difference (target, adapter, origin, durable↔temporary) requires new approval.
- The CLI asks interactively, as `expose` does. Durable consent copy names the difference: "stays reachable after Gozar exits, until you release it".

### Ownership: intent is not proof

The record, with intent `creating` and the exact rule to be created, is written and fsynced before the provider command runs. After the command, Gozar writes a **receipt** (the provider resource identity it created and the readback that confirmed it) before it publishes the origin.

An intent without a receipt proves only that Gozar meant to create the rule, not that it did: after a crash before the command, another program may create an identical rule. So on recovery:
- intent, no receipt, rule absent → `lost` (nothing to clean);
- intent, no receipt, rule present → `uncertain`. Gozar does not claim, verify into `usable`, or remove that rule. The host can take it with an explicit `adoptRoute` (fresh approval) or drop the record with `releaseRoute`, which then leaves the rule in place and reports it;
- receipt present → normal reconciliation.

### Visibility replaces a lifetime

A durable route has no expiry, so the user must always be able to see it and stop it without the app that made it:
- `gozar status` with no arguments lists every session **and** every durable and service route in the home. Each durable route shows its route ID, provider (adapter), origin, owner app, created-at time and state. `gozar status --route ID` shows one. `--json` gives the same fields.
- `gozar stop --route ID` releases the route with compare-and-remove (below), exactly as `releaseRoute({mode:'remove'})` does.
- **A user stop is sticky.** It leaves a small tombstone for the route ID. The owner app's next `ensureRoute` for that ID is refused with `stopped_by_user` instead of quietly re-creating the route. The app may create it again only with `reconsent: true`, which a host sets only after it has shown the durable consent prompt again. A tombstone is deleted by that re-consented call or by `releaseRoute` from the app.

### Stop

`releaseRoute({mode:'remove'})` first marks the record `releasing` durably, so publication is withdrawn even if the process dies. It then removes the provider route by **compare-and-remove**: read the provider config, require an exact match with the receipt, and remove only that listener. Where the provider offers an ETag (Tailscale serve config), removal is conditional on it, so a concurrent edit makes the removal fail instead of deleting the edit. Where no conditional write exists, the residual window between readback and removal is documented, and an identical delete-and-recreate by another program inside that window cannot be detected. A mismatch leaves the foreign config in place and records **cleanup debt**, as sessions do today. Gozar never removes a rule it cannot attribute to a receipt.

`releaseRoute({mode:'hand-back'})` deletes the record without touching the provider route and returns a claim, for rollback to a previous owner.

### Adoption

`adoptRoute` takes ownership of a provider route that exists now, with **no teardown**. Matching the config proves the route is the right one. It does not prove the caller has the authority to take it from its previous owner. So adoption needs both:

1. **Exact match.** `claim` is the exact rule the previous owner recorded (for Tailscale: node DNS name, HTTPS port, mode, proxy target). Under the reservation lock, Gozar reads fresh provider config and requires an exact match: same port, mode and target, no other handler on that port, and the computed origin equals `origin`. Then it verifies through the challenge and re-reads the provider config, to confirm the rule did not change during verification. Any difference is refused, and nothing changes.
2. **Fenced handover.** `handover: { from, generation }` asserts that the previous owner has already fenced itself: it has recorded that generation as handed over and will no longer create, re-create or remove that rule. Gozar stores `from` and `generation` in the record with provenance `adopted`. Gozar cannot fence another program, so this is a precondition the caller must meet. **If the previous owner cannot record the fence, the caller must not adopt**, and the route is migrated by release and re-creation instead.

Rollback is the reverse: `releaseRoute({mode:'hand-back'})` returns the claim, and the previous owner lifts its fence with a newer generation. At every moment exactly one side may mutate the rule.

No double exposure: adoption refuses if the reservation table already holds the listener or the provider port for a session or another record.

### Tailscale adapters

Durable Funnel/Serve recipes use `--bg`. They choose the HTTPS port from the node's `funnel-ports` capability (candidates 443, 8443, 10000; only 443/8443/10000 can be Funnel ports), refuse occupied ports instead of replacing them, and remove with `serve --https=PORT off` (which works after Funnel permission is revoked), conditional on the serve-config ETag where reachable. Continuity across restarts compares the node DNS name and the exact rule. Gozar does not claim stronger node identity than that. The current session recipes (foreground, :8443) stay as they are.

### Per-adapter idle limit

Adapters publish `idleTimeoutMs` (unknown = null) so hosts with long-lived streams can send keepalive data in time. This is data only, not behaviour.

## Implementation: a new owned-route path in the host

The pure plan engine is reused. The session host is not. Today's driver admits only long-running owned processes as creates, derives ownership continuity from live processes, requires a gate for proof, installs a lifetime timer, and on shutdown stops and reconciles. A durable route needs the opposite on each point. So the host gets a separate bounded transaction:

1. a finite create command, admitted only with an owned-route receipt and a readback guard (a new path, not a relaxed guard in the session driver);
2. a persisted route resource identity in the record, so a fresh process can rehydrate it after exit or reboot;
3. proof through the service verifier, with no gate and no lifetime timer;
4. exact compare-and-remove from the receipt.

The session path does not change.

## Not in scope
- Finite lifetimes for durable routes (see "Lifetimes").
- macOS host (plan R12) and ngrok operational recipes (slice S1). Durable routes are designed for them but ship first for Tailscale on Linux.
- Authentication for the app's own routes (plan R5).
- Authenticated origin migration. An app that wants to move clients to a new origin signs that itself. Gozar only refuses to move silently.

## Tests (written red first)
`test/node/durable-routes.test.mjs` with a fake `tailscale` on PATH whose state lives in a temporary file. These tests prove contract behaviour against the fake. They do not prove real provider atomicity or reboot behaviour.

Allocation and pinning:
1. ensure creates a `--bg` rule, writes a receipt, verifies through the challenge, and records `gozar-owned`;
2. a second ensure with the same tuple reuses the rule and makes no mutation;
3. a pinned origin with a different node DNS name → `address_changed`, no mutation;
4. a readback mismatch after creation → removes only its own rule → `address_changed`;
5. occupied port → refused, the foreign rule is untouched;
6. restart with an omitted origin uses the recorded pin; a conflicting origin or adapter is refused;
7. a saved `lost` record is restored only at the pinned origin and never re-allocated unpinned;
8. an adapter without `addressStability: 'stable'`, or a `lifetimeMs`, → durable refused.

Consent:
9. a changed approval tuple → refused;
10. fallback to another adapter only on a first allocation, and only with that adapter's own approved tuple.

Crashes and races:
11. crash after intent, before the command → `lost`;
12. crash after intent, then an identical foreign rule appears → `uncertain`, not claimed, not removed;
13. crash after the command, before the receipt → `uncertain`;
14. release with a changed rule → cleanup debt, foreign rule untouched, record stays; an edit between readback and removal makes the conditional removal fail;
15. release racing a late create or verification → the route is not re-published, and debt is kept;
16. concurrent ensure, adopt and session for one listener or port with distinct origins → exactly one wins;
17. `removeService` on a `gozar-owned` record → refused.

Visibility:
21. `gozar status` with no arguments lists a durable route with route ID, provider, origin, owner app, created-at time and state, next to sessions and service routes; `--json` has the same fields;
22. `gozar stop --route ID` removes the provider rule by compare-and-remove and deletes the record; with a changed rule it leaves the rule, keeps cleanup debt and says so;
23. after `gozar stop --route ID`, the owner app's `ensureRoute` is refused with `stopped_by_user` and makes no mutation; with `reconsent: true` it creates the route again.

Adoption:
18. adopt of an exact rule with a handover → no provider mutation, record `adopted`; a mismatch, a missing handover, or a rule change during verification → refused;
19. adopt while the reservation table holds the listener or port → refused;
20. hand-back then re-adopt with a newer generation → exactly one owner at every step.

## Expect it to work because:
Both halves exist and are tested. Service routes already persist 0600 records under locks and verify with an HMAC challenge inside the app, with no gate. The plan engine already computes provider rules, readback and cleanup debt. A durable route joins them through a small new host transaction (create with receipt, rehydrate, compare-and-remove) instead of the session driver, with three rules on top: the record is authoritative for the origin, intent without a receipt is never ownership, and adoption needs a fenced handover. The design review showed the session driver cannot run a durable route as a one-shot, so the first implementation step is a spike of exactly that transaction: finite create → persisted receipt → process exit → fresh rehydrate → exact remove, with service-verifier proof, no gate and no timer, against the fake provider, including foreign-rule preservation and crash uncertainty. If the receipt cannot be made to rehydrate without the session controller, the spike shows it before the rest is built.
