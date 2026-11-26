# Gozar as an imported library

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

The viable anonymous direction is a managed logical route that can publish a
new verified origin to the host's signed address directory. It cannot promise
an unchanged URL for weeks. Reconnecting after sleep also cannot preserve an
already broken HTTP request. Five-minute quiet responses require an eligible
provider and protocol evidence, not SSH keepalives alone.

## Build target and acceptance

Offer one host operation over an existing listener: return a published managed
route or one current setup/consent action. Operational failures remain typed
and carry retained cleanup state. The application supplies its identity,
storage and approval UI, not provider branches. Final API naming follows the
current-contract survey; no convenience method described here is implemented yet.

The resource must expose verified origin changes, publication withdrawal,
`downSince`, watch and close. Persisted intent and bounded reconnect belong in
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
