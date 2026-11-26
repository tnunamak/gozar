# Gozar as an imported library

## The experience to ship

**Proposed API, not implemented yet.** The app already owns its loopback listener
and UI. These are the consumer lines the installed-package tests must import:

```js
import * as gozar from '@tnunamak/gozar';
let route = await gozar.forward({ app: 'faravan', port, policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
while (route.needsAction) {
  route = await route.resume(await ui.show(route.needsAction));
}
publishSignedAddress(route.url);
route.on('change', ({ oldOrigin, newOrigin, at }) => publishSignedAddress(newOrigin, { oldOrigin, at }));
route.on('down', ({ downSince }) => showOffline(downSince));
route.on('back', showOnline);
await ui.untilClosed();
await route.close();
```

`forward` owns cataloging, selection, operation IDs, consent receipts, readiness,
recovery and cleanup. A published result has `url`, `provider`, `lifetime` and
`needsAction: null`. `lifetime` distinguishes a persistent provider route from
a session; neither describes a promise of uninterrupted access. `provider`
includes the typed payload-visibility facts the app uses to choose encryption.

An action result has one `needsAction` to render and `resume(answer)` to continue.
The answer expresses the user's decision or supplied input, not a token/digest;
Gozar rechecks the current step before acting. For a host that handles steps
immediately, `onAction: ui.show` runs the same UI hook inside `forward`. It never
turns an unknown or incomplete step into approval.

When no provider meets the policy, the developer catches a typed error, for example:

```js
{
  code: 'requirements_unsatisfied',
  message: 'No public HTTPS provider meets the requested account and address policy.',
  nextAction: null
}
```

This is a failure, not a fictitious setup step that cannot satisfy the policy.
`close()` resolves only when owned cleanup is confirmed; otherwise it rejects
with `cleanup_debt`, retaining its journal and retry authority inside Gozar.

The default scope is the app's private managed state. Advanced hosts can supply
storage, backend and identity through their configured factory. A normal
crash/restart or reconnect does not require another click when the approved
disclosure is unchanged. Explicit stop/revocation and changed disclosure still
require fresh approval. Selection prefers an already usable lasting route,
then an eligible anonymous session, using Gozar's provider data rather than
branches in the host.

The first change subscription must receive a persisted startup origin change
as well as later changes; an event must not be lost before `forward` returns.
Its `at` records when the new verified origin was observed, not an invented
time during offline operation. The app signs/distributes its address records;
Gozar does neither. A verified recovery emits `back` and clears the current
`downSince` while preserving the outage observation for that event.

Assessment: 2026-11-26. The first consumer is an application exposing an existing
loopback HTTP listener to public HTTPS clients. The application owns its listener;
Gozar owns reachability, provider selection and the route lifecycle.

## First use today

With the application's port and state directory already known, the first ten
ordinary lines describe a request, rather than return an address:

```js
import { createGozar } from '@tnunamak/gozar';
const api = createGozar();
const query = {
  schemaVersion: 1,
  home: appStateDirectory,
  owner: 'member-service',
  target: `127.0.0.1:${port}`,
  usage: { kind: 'attached' },
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] },
};
```

The remaining path is `catalogRoutes(query)`, choose an eligible candidate,
render its consent, obtain approval, persist an operation ID, and call `expose`
with that candidate's token, disclosure revision and consent digest. Only
`published` is shareable. The host must retain partial handles, observe changes,
and check `closeRoute`'s cleanup result. See the [complete example](../README.md#route-by-requirement).
Fewer printed lines would not remove those responsibilities.

Provider preferences are already data: the catalog ranks candidates;
`getRoutePreferences`/`setRoutePreferences` store their order. `providerId` can
pin one explicitly. Starting one candidate does not automatically try others.
Errors expose `code`, `message`, `nextAction`, and sometimes `route`; a failure
with a route can still owe cleanup. See the [contract](embedding-contract.md).

## Prior art

These are different ownership models, not interchangeable implementations.
Authentication and installation prerequisites are outside the small call shown.

| Library | First useful call and result | Choice and lifecycle |
|---|---|---|
| [ngrok JavaScript](https://github.com/ngrok/ngrok-javascript) | `await ngrok.forward({addr: port, authtoken_from_env: true})`; listener exposes `url()` | ngrok only; listener has async `close()`, status callbacks and rejected start promises |
| [ngrok Go](https://github.com/ngrok/ngrok-go) | `ngrok.Listen(ctx)` returns a listener with `URL()`; pass it to `http.Serve` | ngrok only; Go errors and context/listener lifecycle |
| [tsnet](https://tailscale.com/docs/features/tsnet) | create `tsnet.Server`, then `Listen("tcp", ":80")` | embedded Tailscale node and identity; not an existing-listener forwarding API or automatic public HTTPS |
| [cloudflared](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) | documented quick path starts `cloudflared tunnel --url …` and reports a temporary URL | connector process; a supported general-purpose embedding SDK was not established by this assessment |
| [localtunnel](https://github.com/localtunnel/localtunnel) | `await localtunnel({port})` returns a tunnel with `url` | provider/server-specific; events and close lifecycle; requesting a subdomain is not retaining its ownership |

Gozar should offer the same small resource-shaped entrypoint for an existing
listener, while keeping its provider-neutral selection and stronger proof,
consent and cleanup semantics. It should not require the application to turn
the CLI into its library interface.

## The decisive consumer constraint

A lasting service intent, a persistent provider rule, an unchanged address and
an uninterrupted request are four separate properties. Today `durable` excludes
the anonymous session providers. Relabeling a session would not fix this.

For new installations, [tunnl.gg stable URLs](https://tunnl.gg/stable-urls)
require account/key registration; the old-key exception ends December 1.
[localhost.run free names rotate](https://localhost.run/docs/forever-free).
The separate continuity survey found no documented anonymous, exclusively
retained weeks-long address among those services, Serveo and localtunnel.
A requested name is insufficient evidence. No hosted route was tested.

The consumer accepts a managed logical route that can publish a new verified
origin to its signed address directory. It no longer requires an unchanged
anonymous URL or long quiet responses; both sides retry short polls. Reconnecting
after sleep cannot preserve an already broken HTTP request. Other consumers'
streaming requirements still need provider/protocol evidence.

## Build target and acceptance

Offer one host operation over an existing listener: return a published managed
route or one current setup/consent action. Operational failures remain typed
and carry retained cleanup state. The application supplies its identity,
storage and approval UI, not provider branches. The proposed `forward` contract
above is the README-driven target; it has not shipped.

The resource must expose verified origin changes, publication withdrawal,
`downSince`, events and close. Persisted intent and bounded reconnect belong in
Gozar. Provider order and account, stability, streaming and payload-visibility
constraints belong in catalog data. A fallback must satisfy the approved policy;
a changed disclosure requires fresh approval. Debt must not disappear to make
another allocation look successful. Distinct applications keep distinct scopes.

Acceptance is an installed-package consumer using a real owned local listener:
short first use, published-only output, one actionable setup result, approved
selection/fallback, origin withdrawal/reannouncement, restart recovery and exact
cleanup isolation. Negative tests cover stale consent, unsuitable anonymous
providers, unknown payload visibility and retained debt. A final consumer check
must distinguish this from an unchanged-URL guarantee.

First build: correct the stale tunnl.gg account metadata and disclosures.
Parallel prepaid surveys cover SDK entrypoints and the current orchestration
gap. Their evidence determines the bounded API/lifecycle build rows; no provider
promise, release or live deployment follows merely from this note.
