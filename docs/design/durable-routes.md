# Design: durable routes and route adoption

Status: revision 7. Decision: Tailscale durable routes use the LocalAPI with ETag compare-and-set. Revision 7 removes `adapterId` and `approvals` from the app's calls: the app passes a Query, and Gozar chooses the adapter from a single-use approval token that its own catalog issued (see "Approval tokens"). Targets Gozar 0.2.0.

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

One home-wide **reservation lock** serializes every allocation that can collide: sessions (`expose`), `ensureRoute`, `adoptRoute` and `releaseRoute`. Under it, Gozar keeps a reservation table of `{listener target}` and `{adapter, provider resource}` (for Tailscale: node and HTTPS port). A caller takes the lock **before** it scans the provider and holds it through commit. Acquisition blocks with a bounded wait (30 s) instead of failing at once as `busy`, so a `releaseRoute` that arrives during a create runs after it and sees the committed record, instead of being turned away. Per-origin locks are not enough, because two routes with different origins can still claim the same listener or provider port.

### API (Node, `@tnunamak/gozar/service`)

The app never names an adapter. It passes the contract's Query fields and, for a new route, an approval token.

```js
// Create the route, or reuse the one this record owns. Idempotent.
await ensureRoute({
  schemaVersion: 1,
  owner,              // app name shown to the user, for example 'example-app'
  target,             // '127.0.0.1:PORT' - the app's own listener
  usage: { kind: 'durable', routeId },  // routeId: app-chosen, stable
  requirements, route, origin,          // the Query the user approved; origin is optional
  approval,           // { candidateToken }; needed for a first creation, see "Approval tokens"
  reconsent,          // true only right after the user approved again; see "Visibility"
  home,
});
// -> { schemaVersion: 1, route: { routeId, owner, createdAt, origin, target, adapterId, ownership: 'gozar-owned',
//      lifetime: 'provider-persistent' | 'host-supervised', state, verification } }

// Take over a provider route that exists now. Needs the app to be running (it verifies the challenge).
await adoptRoute({ ...query, usage: { kind: 'durable', routeId }, origin, approval, handover, migrationRef, reconsent });
await releaseRoute({ routeId, mode: 'remove' | 'hand-back', home }); // hand-back is phase 1; see "Hand-back"
await confirmHandBack({ routeId, transfer, home }); // phase 2, after the previous owner took the rule back
await statusServices({ home });   // re-observes and re-verifies; never trusts saved readiness
await durablePlanFacts({ home, adapterId, target, origin }); // read-only; used by the catalog, see below
await inspectLegacyRoute({ home, owner, source: { stateFiles }, target, origin }); // read-only; see "Legacy inspection"
```

A session usage (`usage.kind: 'session'`) is refused with `durable_lifetime_unsupported`. Any usage other than `durable` is `invalid_input`.

The app verifies with the existing `createServiceVerifier()` in its own request handler. **No Gozar gate process sits in the data path** of a durable route. The provider forwards straight to the app's listener, so Host and the provider's forwarding headers reach the app unchanged.

### What a durable route exposes: owner-run, not app-bound

A durable route is a **standing forward** from the public origin to the target port. The user who approved it owns it, not the app process. Between Gozar calls, the provider forwards to whatever listens on the target, whether or not the approved app is running:
- if the app exits and another process binds the same port, that process is reachable at once, before any Gozar call or challenge;
- if the node's DNS name changes while no Gozar call runs, the rule keeps forwarding under the new name.

So **pinning fails closed for publication and for Gozar's own mutations, not for traffic.** Gozar never publishes, reports or re-creates a route at a different origin, and never mutates a rule it cannot attribute. It does not claim that traffic stops when the app stops.

Why not bind the route to the app: stopping traffic when the app exits needs a component in the data path (a gate) or a resident supervisor, and a durable route has neither by design, so that it survives app restarts and reboots. An app that wants exposure only while it runs uses a session.

What makes this acceptable:
- The durable consent copy says so: "stays reachable at ORIGIN whether or not OWNER is running, until you stop it with `gozar stop --route ID`".
- `gozar status` shows each durable route as `owner-run` and states `forwards to 127.0.0.1:PORT whether or not OWNER is running`. It also shows a live target check: `app answering` (the challenge passes), `nothing listening`, or **`another program is listening`** (the target answers but the challenge fails). The last one is shown as a warning, with `gozar stop --route ID` as the next action.
- Hosts use a port they keep for the route. On shared multi-user machines a durable route to a TCP loopback port is not recommended. A later version may support unix-socket targets in a private directory, which give the listener an identity.

### Resolution: the record is authoritative

`ensureRoute` takes the reservation lock, then loads the record for `routeId` **before** it computes any candidate or chooses a port.
- **No record:** this is a first allocation. It needs an approval token (see "Approval tokens"). The adapter is the one in the token's grant. `origin` may be absent.
- **Record exists:** the record is the **pin**: its origin and adapter never move. A caller `origin` that differs is refused with `origin_changed`. An absent `origin` means "the recorded one", never "unpinned". No token is needed, and a token that is passed is not used. A different preference, a different catalog order or a token for another adapter never moves the pin.
- **Record in `lost`, `suspended`, `address_changed`, `uncertain` or `releasing`:** never treated as a new allocation. `lost` and `suspended` may be restored at the pinned origin (below); the other states need `releaseRoute` or `adoptRoute` first.

A restore re-computes the recipe digest for the recorded adapter. If it differs from the digest saved on the record, the recipe changed since the route was made, and the call fails with `adapter_changed`. Gozar mutates nothing.

After every await, the call re-reads the record generation and stops if a concurrent `releaseRoute` moved it to `releasing`. A late create or verification can never re-publish a released route.

### Lifetimes

An adapter declares how its durable route lives:
- `provider-persistent`: the provider keeps the route without a process, for example Tailscale `serve --bg` / `funnel --bg`. The route survives app exit and reboot. Removal is an explicit provider command.
- `host-supervised`: the route exists only while a process runs, for example an ngrok agent. The embedding app keeps that process alive by calling `ensureRoute` on start. Gozar re-creates the process and requires the **same origin** back.

**Durable routes have no finite lifetime in 0.2.0.** A host-set expiry on a `provider-persistent` route has no enforcer: if no Gozar call runs after the deadline, the route stays reachable indefinitely. So a durable request has no lifetime field, and a `session` usage is refused with `durable_lifetime_unsupported`. Exposure for a bounded time stays with sessions, which own a live process and a timer. A later version may add expiry with an independent, persistent owner (for example a systemd timer) and an absolute `expiresAt` that reuse can never extend.

An adapter can offer a durable route only if it declares `addressStability: 'stable'`, meaning the same inputs give the same origin. Anonymous localhost.run fails this. So does any relay that assigns random names. Such adapters stay session-only.

### States

`creating → (usable | unverified) → (lost | address_changed) → releasing → released`, plus `uncertain`.

- `lost`: the provider route is absent. Gozar does **not** re-create it on its own. The host decides, normally by calling `ensureRoute` on start. That restores the route only if the result would have the pinned origin.
- `address_changed`: the provider would give, or gives, a different origin. **Terminal for publication.** Gozar never reports the new origin as the route's origin. The host must release, then create a new route with new consent.
- `unverified`: the receipt exists (Gozar made the rule), but the challenge through the origin failed. No origin is published. The next `ensureRoute` or `statusServices` re-verifies. Because the receipt proves ownership, `releaseRoute` may remove the rule.
- `creating`: an interrupted create with an exact empty-slot intent match can be finished by ensure or removed by release, even before a receipt exists.
- `uncertain`: Gozar has an intent without empty-slot evidence or the slot has a foreign claim, **or** a `lost` route's pinned port now holds a rule Gozar cannot tell apart from its own changed rule. Not owned. Reported as cleanup debt. The route is never moved to another port.

### Suspend and resume

Before closing its local listener, an app can call the root API's
`suspendRoute({ home, handle })` with its durable handle. The CLI equivalents are
`gozar suspend --route ID --json` and `gozar suspend --handle-file FILE --json`.
A handle file holds the handle itself or `{ home, handle }`. Suspend returns a
RouteView with `state: 'suspended'`, the pinned `origin`, and `published: null`.
Wait for success before closing the listener: a failed suspend can leave traffic
forwarding to that listener. Suspension is explicit; an app crash does not invoke it.

The transition is `usable | unverified | lost → suspending → suspended`.
Suspend reads fresh provider state and removes only the exact receipted rule by
compare-and-set. It keeps the route ID, owner, target, adapter, origin, intent,
plan digest, consent and reservation. A suspended route reserves its listener and
provider slot even though it has no receipt or forwarding rule. Repeating suspend
returns the same suspended view without a provider write.

Call `ensureRoute` with the same query on the next start, with the app answering
the challenge. No approval is needed. A suspended record enters the existing lost
route restore path: check the recipe digest, identity and reservation, write only
the pinned slot, read back, save a receipt and verify before publishing. There is
no fallback allocation. Status and watch do not resume routes.

Suspend saves and fsyncs `suspending` with the receipt before requesting deletion.
A crash before deletion leaves an attributable rule and a reservation. A crash
after deletion but before its readback leaves the same receipt; a retry can
confirm absence. Only a fresh read confirming absence permits saving `suspended`
with a null receipt. A retry of suspend finishes that transaction. `ensureRoute`
first finishes an interrupted suspend, then restores through the same pinned path.
A failed or conflicting delete retains the receipt; it never abandons ownership.

The table names engine refusals. At the route API and CLI boundary, `uncertain`
becomes `cleanup_debt`; `adapter_changed`, `port_occupied`, `reserved` and
`route_releasing` become `route_conflict`. Other listed codes pass through.

| Refusal | Meaning and next step |
| --- | --- |
| `uncertain` | The rule changed or neither a receipt nor an exact empty-slot intent attributes it. Nothing foreign is deleted; inspect the route and release or adopt as appropriate. |
| `address_changed` | The node identity changed, or the port is adopt-only. Gozar cannot promise restoration there. An adopt-only rule (private Serve 9443) is refused before suspension changes anything. Leave it running or release it. |
| `adapter_changed` | Resume found a changed plan digest. Release and obtain approval for a new route. |
| `port_occupied` | Resume found another rule on the pinned slot. Leave it untouched; retry only after its owner frees it. |
| `reserved` | Another route or session holds the listener or slot. Resolve that reservation before resuming. |
| `route_conflict` | The handle generation is stale. Read the current route before acting. |
| `handing_back`, `route_releasing` | Finish the hand-back or release before suspending. |
| `stopped_by_user` | Resume is blocked by a user stop. Only renewed consent or `gozar allow` can clear it. |

Provider failures keep the recorded intent and receipt for retry. Hand-back of a
suspended route is refused because there is no receipt to transfer (`not_owned`,
normalized to `invalid_input`). Release drops the suspended record without a
provider write, even if a foreign rule appeared on its slot. User stop does the
same after durably recording its tombstone, so a later ensure cannot resume it.

### Pinned origin fails closed

1. Before any mutation, the adapter's plan computes the candidate origin from fresh observations (Tailscale: node DNS name + selected HTTPS port; ngrok: requested reserved domain). If the record pins an origin and the candidate differs, stop with `address_changed`. Mutate nothing.
2. After mutation, read back the provider config and compare it with the exact recorded rule. Then verify through the challenge from the controller vantage. If the listener read back differs from the rule Gozar wrote, Gozar cannot tell its own rule from a replacement another program made after the write, so it leaves the listener in place as `uncertain` cleanup debt and publishes nothing. If the verified origin differs, it stops with `address_changed`.
3. Provider fallback (for example Funnel not permitted, so try ngrok) is allowed **only on a first allocation**. A pinned route never changes adapter.

### Consent

Consent is a consent receipt that Gozar issued itself, not a list that the app supplies.

- The app asks Gozar's catalog for candidates. For an eligible candidate the catalog shows the user the durable consent copy (`durableConsentText`), then issues a token (see "Approval tokens"). The app passes it back as `approval.candidateToken`.
- **Fallback to another adapter needs its own token.** A token carries exactly one grant (one adapter). The first adapter's token never covers another adapter.
- The record stores the tuple it was created under (target, owner, origin, adapter, plan digest). A later `ensureRoute` with an existing record reuses that consent and needs no token. A changed target or owner gives `consent_changed`.
- The CLI asks interactively, as `expose` does. Durable consent copy names the difference: "stays reachable after Gozar exits, until you release it".

### Approval tokens

`consent-token.mjs` holds the mechanism. Three functions, no app knowledge of adapters:

- `consentBinding(query, canonicalHome, disclosureRevision)` is pure. It returns `{owner, home, target, usage, intent, requirements, route, origin, disclosureRevision}`. The issuer and the redeemer both call it, so they cannot disagree on what a field means.
- `issueConsentToken({home, binding, grant, ttlMs})` returns `{token, expiresAt}`. The grant is `{adapterId, planDigest, observedResource}`. The default TTL is 10 minutes and the longest is 1 hour. On issue it sweeps expired token files, and leftover `.spent` or `.tmp` files older than the longest TTL.
- `redeemConsentToken({home, token, binding})` returns the grant. The binding is compared as a digest of canonical JSON (keys sorted at every depth), so key order never matters.

Rules:
1. **Single use.** The first presentation renames the token file to a unique `.spent` name. Rename is atomic, so one of several racing processes wins and the others get `consent_unknown`.
2. **Spent on any failure.** A token that is expired (`consent_expired`) or whose binding differs in any field (`consent_mismatch`) is spent too. The app must ask the user again.
3. **Hashes only.** The file name is the SHA-256 of the token. The file holds the binding digest, the grant and the expiry (0600). A copy of the state directory cannot spend a token or reveal what it was bound to.
4. **No provider write happens before a successful redeem.** Replay, a race, a changed binding field, or drift all give zero provider writes.

**Plan facts.** `durablePlanFacts({home, adapterId, target, origin})` is read-only. It returns `{planDigest, observedResource, origin}` from fresh provider observation. One function, `planFactsFromObservation`, serves the issuer (the catalog, through `durablePlanFacts`) and the redeemer (`ensureRoute` and `adoptRoute`, under the reservation lock), so the two cannot drift apart by design.
- `planDigest` is a digest of the adapter, the provider resource, the recipe, the target and the origin it would publish.
- `observedResource` is a digest of the provider, the node DNS name, and **the one candidate listener** (port, rule, occupied). It does not cover the rest of the serve config. An unrelated edit to another port, made by another program, does not make a token stale. A change to the DNS name or to the candidate listener does.
- With an `origin` given, the candidate port is the one whose origin matches, whatever currently holds it. Without an origin, it is the first permitted, free, unreserved port.
- An adapter with no durable recipe gives `provider_unsupported` (this is the `unsupported` case of the contract; see "Error codes").

**Redeem under the lock.** On a first creation `ensureRoute` redeems the token, takes `adapterId` from the grant, re-runs the facts under the reservation lock, and compares `planDigest` and `observedResource` with the grant. A difference is `claim_mismatch` (the contract's `candidate_stale`). The token is already spent, so the app asks the user again. The create then pins the port the facts chose (`expectedOrigin`). If a 412 retry would move the allocation to another port, the result is `claim_mismatch` too; Gozar never publishes at an origin the user did not see.

**Cheap refusals come first.** `stopped_by_user`, a listener reserved by another route, and a missing token (`consent_required`) are all decided **before** a token is spent.

### Ownership: recover an exact empty-slot intent

The record and its exact intended rule are written and fsynced before the provider write. Each create attempt records `slotWasEmpty: true` only after observing that the chosen slot is empty and has no foreign claim; its compare-and-set uses that observation's version. This includes restoration of a lost or suspended route. After the write, Gozar saves a receipt from readback before verification and publication.

| Recovery observation | Status and next action |
|---|---|
| Intent, no receipt, rule absent | `lost`; ensure may restore only the pinned origin. |
| Intent with empty-slot evidence, exact deep-equal rule at the pinned identity and slot, no foreign claim | `creating`; ensure reads back, saves a receipt, verifies and publishes without another provider write. Release or user stop removes by exact compare-and-delete. |
| Intent with missing empty-slot evidence, a different rule, or a foreign claim | `uncertain`; release keeps cleanup debt and dismiss may drop that released record while leaving the rule. |
| Receipt present | Normal reconciliation and exact compare-and-delete. |

Existing records without empty-slot evidence remain conservative. Status does not save a receipt or publish an interrupted create. A different provider identity remains `address_changed` for publication; removal reads only the pinned identity, including after a node rename.

Both shipped durable adapters, Tailscale Funnel and private Serve, use the same TCP/Web/AllowFunnel listener format, which has no per-rule description or metadata field for a Gozar marker; Foreground represents another controller and is left alone. The synthetic durable fixture also has a separate foreign-owner flag, which blocks intent attribution. ngrok has no durable facet here, so endpoint metadata cannot close this window for the shipped adapters.

Another program can write an identical rule at the same identity and slot during the crash window, and Gozar will attribute that rule to its intent.

### Visibility replaces a lifetime

A durable route has no expiry, so the user must always be able to see it and stop it without the app that made it:
- `gozar status` with no arguments lists every session **and** every durable and service route in the home. Each durable route shows its route ID, provider (adapter), origin, owner app, created-at time and state. `gozar status --route ID` shows one. `--json` gives the same fields.
- Bare `gozar status` changes additively. When `last.json` names a session, it keeps its old output, JSON shape and exit code, and adds an `inventory` field to the JSON (in human output, an inventory section after the session). With no `last.json`, it prints the inventory and exits 0. `status --port N` is unchanged. `health`, `update-origin` and `stop` without `--port` still use `last.json`. The 0.2.0 changelog names the new `inventory` field.
- Each route shows as `owner-run` with `forwards to 127.0.0.1:PORT whether or not OWNER is running` and a live target check (`app answering`, `nothing listening`, or the warning `another program is listening` with `gozar stop --route ID` as the next action). Routes the user stopped show in a separate section with the `gozar allow --route ID` command.
- `gozar stop --route ID` releases the route with compare-and-remove (below), exactly as `releaseRoute({mode:'remove'})` does.
- **A user stop is sticky.** It writes a durable **consent revocation** (tombstone) for the route ID, fsynced **before** any provider mutation or record deletion. The owner app's next `ensureRoute` for that ID is refused with `stopped_by_user` instead of quietly re-creating the route, and `adoptRoute` for that ID is refused too, with or without an approval token.
- **Only a user action clears it:** `gozar allow --route ID` run by the user, or **both** `reconsent: true` **and** a valid `approval` token. A host may set `reconsent` only right after the user approved the durable consent prompt again in its own UI. Three cases for `ensureRoute` and `adoptRoute`:
  - `reconsent: true` without `approval` → `consent_required`;
  - `approval` without `reconsent` → `stopped_by_user`, and the token is not spent;
  - both, and the token redeems → the tombstone is cleared and the call goes on.

  `releaseRoute` in any mode, hand-back and cleanup never clear it. Gozar cannot tell a host that sets `reconsent` honestly from one that does not; the token proves only that Gozar's catalog showed the consent copy and the user approved it, not that the stop was acknowledged. The CLI path is the only clearance Gozar itself witnesses.

### Stop

`releaseRoute({mode:'remove'})` first marks the record `releasing` durably, so publication is withdrawn even if the process dies. It then removes the provider route by **compare-and-remove**: read the provider config, require an exact match with the receipt, and remove only that listener. For Tailscale, removal is a LocalAPI compare-and-set (see "Tailscale adapters"): Gozar reads the serve config with its ETag, checks the receipt against that read, and writes the config without its own listener with `If-Match` set to that ETag. A concurrent edit makes the write fail with 412, so Gozar never deletes an edit it did not see. A mismatch leaves the foreign config in place and records **cleanup debt**, as sessions do today. Gozar never removes a rule it cannot attribute to a receipt, and never writes provider config without `If-Match`.

**Attribution limit.** Gozar attributes a rule by its exact content. If another program deletes Gozar's rule and creates an identical one between two Gozar calls, Gozar cannot tell them apart and treats the identical rule as its own. Compare-and-set guarantees only that no edit made after Gozar's read is overwritten or deleted.

### Hand-back (two phases)

Hand-back returns a route to its previous owner (for example, a rollback). It is two-phase, so a crash or a lost reply never leaves a rule that nobody owns:
1. `releaseRoute({mode:'hand-back'})`: under the reservation lock, Gozar durably marks the record `handing-back` with a unique transfer token and the claim, keeps the receipt and the reservation, and returns `{ claim, transfer }`. The claim is for the previous owner's rollback; no app input requires it. From then on, Gozar makes no mutation for that route, and `ensureRoute` and `adoptRoute` return `handing_back`. A retry returns the same claim and transfer.
2. `confirmHandBack({routeId, transfer})`: called after the previous owner has durably taken the rule back (lifted its fence with a newer generation). Only then does Gozar delete the record and release the reservation.

Until phase 2, `gozar status` lists the route as `handing-back`. `gozar stop --route ID` still works, because the user outranks both owners: it removes the rule by compare-and-set and writes the tombstone. `cancelHandBack({routeId, transfer})` returns the route to its previous state if the previous owner never took it.

### Adoption

`adoptRoute` takes ownership of a provider route that exists now, with **no teardown**. Matching the config proves the route is the right one. It does not prove the caller has the authority to take it from its previous owner. So adoption needs all of these:

1. **Exact match, found by Gozar.** The caller names no provider and no rule. Under the reservation lock, Gozar reads fresh provider config and, for each adapter that declares a durable capability, looks at each candidate port whose origin equals `origin`. A port matches when its rule deep-equals the adapter's rule for this target (same mode, same proxy target, no other handler) and no foreground session uses it. Exactly one match: proceed. No match: `claim_mismatch`. More than one: `ambiguous_route`. Nothing changes in either refusal.
2. **Fenced handover.** `handover: { from, generation }` asserts that the previous owner has already fenced itself: it has recorded that generation as handed over and will no longer create, re-create or remove that rule. Gozar stores `from` and `generation` in the record with provenance `adopted`. Gozar cannot fence another program, so this is a precondition the caller must meet. A missing handover is `handover_required`. **If the previous owner cannot record the fence, the caller must not adopt**, and the route is migrated by release and re-creation instead.
3. **An approval token with intent `adopt`.** The token is redeemed with the binding `intent: 'adopt'`. Its grant adapter must equal the adapter of the rule Gozar matched. A token for another adapter gives `claim_mismatch` (`candidate_stale`), and the token is spent. The grant's plan digest and observed resource must also equal the facts computed from the fresh observation. A missing token is `consent_required`.
4. **`migrationRef`, if given.** `inspectLegacyRoute` returns `migrationRef`, an opaque digest of `{origin, target, observedResource}`. If the caller passes it, Gozar recomputes it from the fresh observation and refuses a different value with `claim_mismatch`. The route changed since the user was shown it.
5. **Proof.** Gozar verifies through the challenge, re-reads the provider config and requires the same match again. The record stores the adapter, DNS name, port, mode and plan digest it found.

**Adopt verifies the challenge, so the app must be running.** The challenge is answered by the app's own handler. If the app is not serving it, adoption fails, and nothing changes. Start the app, then adopt.

The tombstone rule is the same as for `ensureRoute` ("Visibility"): a stopped route needs `reconsent: true` and a valid `approval`. Adoption of a listener or port that the reservation table already holds is refused (`reserved`), as is a second record for one route ID (`route_exists`).

Rollback is the reverse, through the two-phase hand-back above: the previous owner lifts its fence with a newer generation, then confirms. At every moment at most one side may mutate the rule, and the rule is always listed by at least one owner.

### Legacy inspection

`inspectLegacyRoute({home, owner, source: {stateFiles}, target, origin?})` in `legacy-import.mjs` tells an app whether a route that another program made earlier can be adopted. It reads, it never writes: the only provider requests are the two read-only LocalAPI GETs (node status, serve config).

- **Provider first.** Gozar finds a rule that forwards to `http://target` on any candidate port of any durable adapter, through the LocalAPI. It reads no file format.
- **Every state file is opaque.** No path in `source.stateFiles` is opened, so no file content, path or token can reach the output. A route that only a file could describe (no provider rule, or the provider not answering) gives `blocked` / `unrecognized_format` with a `nextAction` of kind `instructions` ("sign in again"). A provider rule that matches is `adoptable` whatever files the caller names.
- **Result.** `adoptable`, `external` or `blocked`, with a closed `reasonCode`: `not_found`, `target_mismatch` (a rule at that origin forwards elsewhere), `origin_mismatch` (the target is forwarded at another origin), `not_adoptable` (no exact adapter rule, a foreground session, or several origins without one named), `unrecognized_format`. `bridgeHome` is always `null`.
- **`migrationRef`** is returned for every result; the adopt call checks it (above).
- With no provider answer and no file, the typed provider error propagates.

### Tailscale adapters

Durable Funnel/Serve routes change the node's **background** serve config (the same config `serve --bg` writes), but not through the CLI. The CLI reads the config, changes it and writes it back conditional on the ETag from **its own** read, and `SetWebHandler` silently replaces an existing web handler on the same port and path (`cmd/tailscale/cli/serve_v2.go`). So "check that the port is free, then run `tailscale serve --bg`" can overwrite a rule another program adds in between, and "check, then `serve off`" can delete another program's edit.

The listener arithmetic (find a port's rule, tell absent from occupied, add or remove one listener from a config) lives in `tailscale-localapi.mjs` as the `serveListener` object, next to the transport that uses it. `durable-route.mjs` and `legacy-import.mjs` import it from there.

Instead, the durable Tailscale adapter uses the LocalAPI directly, with **compare-and-set for create and for remove**:
1. `GET /localapi/v0/serve-config` returns the config and an `Etag` header.
2. Gozar checks that config: for create, the chosen port has no handler; for remove, the listener equals the receipt exactly.
3. Gozar writes the changed config with `POST /localapi/v0/serve-config` and `If-Match: <that ETag>`. On `412 Precondition Failed`, another program changed the config: Gozar mutates nothing, re-reads, and re-decides from the new state (at most a few attempts, then a typed error). It never retries the same write blindly.
4. It reads back after the write and records the exact listener in the receipt.

The reference for request shapes and the `If-Match`/412 behaviour is the official Go client, `tailscale.com/client/local` (`GetServeConfig`, `SetServeConfig`, `IsPreconditionsFailedError`); the adapter cites it. On Linux the transport is the tailscaled unix socket (default `/var/run/tailscale/tailscaled.sock`, `Host: local-tailscaled.sock`), with the same operator permission the CLI needs.

**Fail closed, no fallback to the CLI.** If the LocalAPI socket is missing, access is denied, the endpoint is absent, the reply has no `Etag`, or the body is not the expected shape, the adapter returns a typed error with a generic code, so apps need no provider knowledge: `provider_unavailable` (start tailscaled), `provider_denied` (run `sudo tailscale set --operator=$USER`), `provider_unsupported` (upgrade tailscaled), `provider_failed` (the provider rejected a write) and `provider_conflict` (retry later, another program is changing serve config). Each error carries `provider` (the provider family, `tailscale`, because the transport layer does not know the adapter id) and `nextAction` (the concrete step, also in the message). It never drops back to the racy CLI path.

**Version range.** The tested tailscaled version is recorded here when the live contract test first runs: tailscaled 1.104.6 (Linux). The request shapes and status codes are cited from the Go client at tag v1.104.6. The ETag is a hash of the config content, so an edit that restores the same bytes between our read and write (ABA) is invisible; this is inside the attribution limit above. The serve-config endpoint with ETag has existed since the 2022 serve redesign; a tailscaled without it (404 or no `Etag`) gets `provider_unsupported`, never a fallback.

Port choice uses the node's `funnel-ports` capability (candidates 443, 8443, 10000; only 443/8443/10000 can be Funnel ports), and occupied ports are refused, never replaced. Removal works after Funnel permission is revoked, because it only deletes the listener from the config. Continuity across restarts compares the node DNS name and the exact rule. Gozar does not claim stronger node identity than that. Session recipes stay foreground; since 0.2.1 a Funnel session takes 8443, or 10000 when 8443 is in use, and never 443.

### Error codes

The source throws only codes that the contract fixture maps in `errorNormalization`. Where the internal reason has a frozen contract name, Gozar uses the mapped code:

| Reason | Code thrown | Contract name |
|---|---|---|
| the token's facts differ from the facts now, or a retry would move the port | `claim_mismatch` | `candidate_stale` |
| the adapter has no durable recipe | `provider_unsupported` | `unsupported` |
| user stop without reconsent | `stopped_by_user` | |
| no token, or reconsent without a token | `consent_required` | |
| token replayed or unknown | `consent_unknown` | |
| token expired, or binding differs | `consent_expired`, `consent_mismatch` | |

### Per-adapter idle limit

Adapters publish `idleTimeoutMs` (unknown = null) so hosts with long-lived streams can send keepalive data in time. This is data only, not behaviour.

## Implementation: a new owned-route path in the host

The adapter data and the plan engine are reused; the session host is not. The spike wrote the Tailscale recipe inline, because `admitPlanEffect` (`plan.mjs`) requires a session ID, a generation and a session-scoped authority for every binding. G1 adds a **route-scoped admission context** (route ID, record generation, route authority) so durable recipes come from adapter definitions like every other route. The durable-capable adapter list also moves from a table in code into adapter data (`addressStability`, `durableLifetime`).

The session host is not reused. Today's driver admits only long-running owned processes as creates, derives ownership continuity from live processes, requires a gate for proof, installs a lifetime timer, and on shutdown stops and reconciles. A durable route needs the opposite on each point. So the host gets a separate bounded transaction:

1. a finite create command, admitted only with an owned-route receipt and a readback guard (a new path, not a relaxed guard in the session driver);
2. a persisted route resource identity in the record, so a fresh process can rehydrate it after exit or reboot;
3. proof through the service verifier, with no gate and no lifetime timer;
4. exact compare-and-remove from the receipt.

The session path does not change.

## The adapter `durable` facet

A provider's durable rules change only through an optional `durable` facet on its adapter. A new durable provider is one directory plus one registry entry; core names no provider. The facet does provider I/O and the arithmetic of its slots. Core keeps the rest.

| Method | What it does |
|---|---|
| `observe(ctx)` | Reads the provider's rules and returns `{ identity, snapshot, version }`. `version` is an opaque token for compare-and-set. |
| `slots(snapshot)` | Lists the places a route can take, each as `{ slot, origin, permitted }`. |
| `read(snapshot, slot)` | Returns the rule in a slot, or `null`. |
| `foreign(snapshot, slot)` | Says whether another program wrote the rule in a slot. A foreign rule is never changed. |
| `occupied(snapshot, slot)` | Says whether anything is in the slot. An occupied slot is skipped. |
| `put(ctx, { slot, rule, version })` | Writes a rule if `version` is still current. Returns `written` or `conflict`. |
| `delete(ctx, { slot, rule, version })` | Removes a rule if `version` is current and the rule is exactly the one given. Returns `written` or `conflict`. |
| `expand(target)` | Turns the loopback target into the rule the provider stores. |
| `expiresAt(snapshot, slot)` and `renew(ctx, { slot })` | Optional. A provider whose rules expire reports when, and renews them. Status renews a rule that is due. |

On `conflict`, core reads again and decides again, up to a fixed bound, then fails with `provider_conflict`. It never writes without the version of a read.

Core keeps: the route record and its intent-then-receipt order, consent and the plan digest, slot choice, reservations between routes, verification and publication, cleanup debt and the user stop. It also keeps the compare-and-set loop and the closed error codes. A provider-specific failure reaches an app only as one of those codes.

`@tnunamak/gozar/testing` writes a durable fake with this facet; its rule store is a JSON file in the registry's directory.

## Not in scope
- Finite lifetimes for durable routes (see "Lifetimes").
- macOS host (plan R12) and ngrok operational recipes (slice S1). Durable routes are designed for them but ship first for Tailscale on Linux. **On macOS the LocalAPI transport differs**: the Mac App Store and standalone Tailscale apps do not expose the Linux unix socket; the LocalAPI is reached on loopback with a token. 0.2.0 implements that transport below the same LocalAPI client, with discovery that follows Tailscale's own CLI (`adapters/providers/_shared/tailscale-app-discovery.mjs`). It is proven by fixture tests only; see [service-routes.md](../service-routes.md#durable-routes-gozar-owned).
- Authentication for the app's own routes (plan R5).
- Authenticated origin migration. An app that wants to move clients to a new origin signs that itself. Gozar only refuses to move silently.

## Tests (written red first)
`test/node/durable-routes.test.mjs`, `consent-token.test.mjs` and `legacy-import.test.mjs`, with a fake Tailscale LocalAPI on a unix socket (`test/node/fake-localapi.mjs`): its ETag changes on every write, a stale `If-Match` gets 412, and a hook injects a foreign edit between Gozar's read and write. The tests issue tokens the way the catalog does, in a helper child process: facts, then `consentBinding`, then `issueConsentToken`. A `tailscale` stub on PATH fails the test if Gozar calls the CLI. `test/node/tailscale-localapi-live.test.mjs` reads the real serve config once, checks only its shape, and prints no values. These tests prove contract behaviour against the fake. They do not prove real provider atomicity or reboot behaviour.

Allocation and pinning:
1. ensure creates a `--bg` rule, writes a receipt, verifies through the challenge, and records `gozar-owned`;
2. a second ensure with the same tuple reuses the rule and makes no mutation;
3. a pinned origin with a different node DNS name → `address_changed`, no mutation;
4. a readback mismatch after creation → the listener is left in place as `uncertain` cleanup debt, nothing is published (Gozar cannot tell its rule from a replacement made after its write);
5. occupied port → refused, the foreign rule is untouched;
6. restart with an omitted origin uses the recorded pin; a conflicting origin is refused; a different preference, or a token for another adapter, never moves the pin;
7. a saved `lost` record is restored only at the pinned origin and never re-allocated unpinned; a changed recipe digest gives `adapter_changed` and writes nothing;
8. an adapter with no durable recipe gives `provider_unsupported` from `durablePlanFacts`; a session usage → `durable_lifetime_unsupported`.

Consent:
9. a new route without a token → `consent_required`; a changed tuple on an existing route → `consent_changed`;
10. a catalog order that offers the other adapter never moves a pin, even when Funnel is available again.

Approval tokens (consent-token and R tests; each fails under the stated mutation, see the report):
- R1. replay, a race of processes on one token, any changed binding field, and an expired token: zero provider writes, no record, token spent. Mutation: do not spend the token on mismatch.
- R2. drift between issue and redeem → `claim_mismatch`, token spent, zero provider writes. Mutation: skip the digest comparison.
- R3. an unrelated foreign edit on another port does not make a token stale, and the edit survives. Mutation: let `observedResource` cover the whole config.
- R4. `durablePlanFacts` is read-only, stable, and changes with the recipe, target, origin and candidate listener.
- R5. a crash after intent and before the write, with a token, gives uncertainty once a different or provider-marked foreign rule appears, never a claim.

Crashes and races:
11. crash after intent, before the command → `lost`;
12. crash after intent, then a different foreign rule appears → `uncertain`, not claimed, not removed; an identical unmarked rule falls within the residual race above;
13. crash or readback error after the command, before the receipt → `creating`; ensure finishes receipt and publication, while release or user stop removes the exact intended rule;
14. release with a changed rule keeps cleanup debt, foreign rule untouched, record stays; an edit between readback and removal makes the conditional removal fail (412) and the foreign edit survives;
15. release racing a late create or verification → the route is not re-published, and debt is kept;
16. concurrent ensure, adopt and session for one listener or port with distinct origins → exactly one wins;
17. `removeService` on a `gozar-owned` record → refused.

LocalAPI contract:
24. a foreign edit between Gozar's GET and its POST, for create and for remove, gives 412; Gozar mutates nothing, re-reads, and never overwrites or deletes the foreign edit (fake socket);
25. a missing socket, a denied request, a 404 endpoint, a reply without `Etag`, or an unexpected body each give the named typed error, and no CLI command runs;
26. live, read-only: against this host's tailscaled, `GET serve-config` returns a parseable config and an `Etag`; skipped when no tailscaled is running; asserts shape only and prints no config values.

Visibility:
21. `gozar status` with no arguments lists a durable route with route ID, provider, origin, owner app, created-at time and state, next to sessions and service routes; `--json` has the same fields;
22. `gozar stop --route ID` removes the provider rule by compare-and-remove and deletes the record; with a changed rule it leaves the rule, keeps cleanup debt and says so;
23. after `gozar stop --route ID`, the owner app's `ensureRoute` is refused with `stopped_by_user` and makes no mutation; with `reconsent: true` and a fresh approval it creates the route again;
27. stop, then the app's `releaseRoute` (every mode), then a restart and `ensureRoute` with the saved token → still `stopped_by_user`; `adoptRoute` after a user stop → refused; `gozar allow --route ID` clears it; reconsent without approval → `consent_required`; approval without reconsent → `stopped_by_user`; both → cleared; a crash during `gozar stop` after the tombstone write and before the provider write still blocks recreation.

Hand-back:
28. a crash after the `handing-back` write and before the reply, and a crash after the reply and before confirmation: the route stays listed as `handing-back` with its receipt and reservation; a retry returns the same claim and transfer;
29. `ensureRoute` and `adoptRoute` during hand-back → `handing_back`, no mutation; `gozar stop --route ID` during hand-back removes by compare-and-set and writes the tombstone; `confirmHandBack` with a stale transfer → refused.

Owner-run exposure:
30. the app stops and another server binds the target port: the provider rule still forwards (the design does not prevent this), and `gozar status` shows `another program is listening` with `gozar stop --route ID` as the next action; with nothing listening it shows `nothing listening`;
31. the node DNS name changes while no Gozar call runs: the next status shows `address_changed` and never reports the new origin as the route's origin.

Adoption:
18. adopt of an exact rule with a handover and a token → no provider mutation, record `adopted`; a mismatch, a missing handover, or a rule change during verification → refused; a token for another adapter than the matched rule's → `claim_mismatch`, no change; a wrong `migrationRef` → refused;
19. adopt while the reservation table holds the listener or port → refused;
20. hand-back then re-adopt with a newer generation → exactly one owner at every step.

Legacy inspection (`legacy-import.test.mjs`):
32. an exact rule is `adoptable`; the result has exactly the contract's keys, and `migrationRef` equals the digest adopt recomputes; an unrelated edit leaves it unchanged and an edit to the listener turns it `external`;
33. `blocked` reasons `not_found`, `target_mismatch`, `origin_mismatch`, `not_adoptable`;
34. a state file (known, missing, unreadable) gives `unrecognized_format` and a `sign in again` action; the output holds no file content, no path and no token; the files and their access times are unchanged, and every provider request is a GET.

## Expect it to work because:
Both halves exist and are tested. Service routes already persist 0600 records under locks and verify with an HMAC challenge inside the app, with no gate. The plan engine already computes provider rules, readback and cleanup debt. A durable route joins them through a small new host transaction (create with receipt, rehydrate, compare-and-remove) instead of the session driver, with three rules on top: the record is authoritative for the origin, an exact empty-slot intent can recover ownership, and adoption needs a fenced handover. The design review showed the session driver cannot run a durable route as a one-shot, so the first implementation step is a spike of exactly that transaction: finite create → persisted receipt → process exit → fresh rehydrate → exact remove, with service-verifier proof, no gate and no timer, against the fake provider, including foreign-rule preservation and crash uncertainty. If the receipt cannot be made to rehydrate without the session controller, the spike shows it before the rest is built.
