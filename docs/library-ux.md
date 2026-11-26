# Gozar as an imported library

## The experience to ship

The app already owns its loopback listener and UI. Its request handler calls
`createServiceVerifier()` first, as for [service routes](service-routes.md), so Gozar can prove
that the published address reaches this app. The installed-package tests import and run
these consumer lines unchanged:

```js
import * as gozar from '@tnunamak/gozar';
let route = await gozar.forward({ app: 'faravan', port, policy: { accounts: 'existing-only', lifetime: 'prefer-lasting' } });
try {
  while (route.needsAction) route = await route.resume(await ui.show(route.needsAction));
  route.on('change', ({ oldOrigin, newOrigin, at }) => publishSignedAddress(newOrigin, { oldOrigin, at }));
  publishSignedAddress(route.url);
  route.on('down', ({ downSince }) => showOffline(downSince));
  route.on('back', showOnline);
  await ui.untilClosed();
} finally {
  await route.close();
}
```

`forward` owns cataloging, selection, operation IDs, consent receipts, readiness,
recovery and cleanup. A published result has `url`, `provider`, `lifetime`,
`downSince` and `needsAction`. `lifetime` distinguishes a persistent provider route from
a session; neither describes a promise of uninterrupted access. `provider`
includes typed facts about whether the provider can read the traffic, so the app
can choose encryption.

`url`, `downSince` and `needsAction` are current properties: read them each time
you use them. `url` is the verified address, or `null` while the route is down, so
never keep the startup value as the address. `downSince` is when the current outage
began, or `null`. `needsAction` is `null` unless a later user step is waiting.
In TypeScript, the result of `forward` is either a pending step or a published route.
Check `'on' in route` once after the loop, as below, before calling `route.on`;
`forward({ ..., onAction })` returns the published route directly.

```ts
while (route.needsAction) route = await route.resume(await ui.show(route.needsAction));
if (!('on' in route)) throw new Error('forward returned a pending step');
```

An action result has one `needsAction` to render and `resume(answer)` to continue.
The answer expresses the user's decision or supplied input, not a token/digest;
the descriptor lists acceptable answers, and Gozar rechecks the current step
before acting. Action results also have `close()`, so a failed or dismissed UI
can cancel and clean up the pending attempt. For a host that handles steps
immediately, `onAction: ui.show` runs the same UI hook inside `forward`. It never
turns an unknown or incomplete step into approval.

The descriptor's `answer.type` says what to collect:

| `answer.type` | The answer |
|---|---|
| `decision` | `{ approve: true }` or `{ approve: false }` |
| `value` | `{ approve: true, value: '…' }`; `answer.format` names the kind of text and `answer.options`, when present, lists the accepted values |
| `secret` | `{ approve: true, secret: '…' }`; Gozar hands it to the configured secret backend and does not return it |

`{ approve: false }` declines. The run stops, nothing is published, and the call
rejects with `stopped_by_user`. An answer the step does not accept, or an answer to
a step that a newer step replaced, rejects with `invalid_input`; render the current
`needsAction` again. A route that is already published can need a later user step
too. Then `route.needsAction` holds it, `route.on('action', render)` announces it and
`route.resume(answer)` answers it; the loop above handles it the same way.

When no provider meets the policy, the developer catches a typed error with a
per-provider explanation. For a strict lasting-route request on a machine
without a ready lasting provider, for example:

```js
{
  code: 'requirements_unsatisfied',
  message: 'No public HTTPS provider meets the requested account and address policy.',
  unmet: [
    { provider: 'tunnl.gg', missing: ['account', 'lasting route'],
      policyChanges: { accounts: 'allow-setup', lifetime: 'session' } },
    { provider: 'localhost.run', missing: ['lasting route'],
      policyChanges: { lifetime: 'session' } },
  ],
  nextAction: null
}
```

Each entry also has `kind` (`'durable'`, `'session'` or `'attached'`), the route type
Gozar considered. The app can render every entry without provider branches. `policyChanges`
explains an alternative the caller may explicitly request; it never applies
it. Allowing account setup permits an action, not a claim that sign-in already
succeeded. Unknown prerequisites remain unknown, and an explanation must not
suggest a policy change that still cannot admit the provider. Diagnostics cover
every considered provider, including unavailable and unknown candidates.

This is a failure, not a fictitious setup step that cannot satisfy the policy.
Here `nextAction: null` means there is no setup action that can satisfy the
current policy. The caller must explicitly choose a different policy to retry.

`close()` is the explicit stop of this managed run. It first records that the
run must not reconnect, then resolves only when owned cleanup is confirmed.
Otherwise it rejects with `code: 'cleanup_debt'`; the app must report that
cleanup is unconfirmed, not that the route is off. It can retry `route.close()`.
The cleanup record survives process exit. A later `forward` call for this app
reconciles that debt before starting anything and rejects with `cleanup_debt`
if removal is still unconfirmed. No background retry is promised while the
application is not running.

The default scope is the app's private managed state under the default Gozar home
(`GOZAR_HOME`, when set). Advanced hosts can supply storage, backend and identity
through their configured factory, and a different scope for `forward`'s managed state:

```js
import { createGozar } from '@tnunamak/gozar';
const gozar = createGozar({ forwardHome: '/var/lib/faravan/gozar', secretBackend, identity });
const route = await gozar.forward({ app: 'faravan', port, onAction: ui.show });
```

`forwardHome` is an absolute path. It moves only `forward`'s managed state; every
other call still takes its own `home`. The factory's registry, secret backend, host
capabilities, identity and origin acknowledgment apply to its `forward`, exactly as
to its other calls. Creating a factory starts nothing and writes nothing.

A normal restart uses the same `forward({ app, port, policy })` call; the host does not
look up a handle or run a separate recovery step. Within the app's state scope,
the same `app` identifies its managed service. Gozar rechecks the supplied target,
policy, current provider facts and saved approval before reattaching or
re-establishing the route. An unchanged approved disclosure needs no second
consent click; a different `port` is a different target and asks again. Reattachment can return `needsAction` when approval or setup is
needed. A changed policy is re-evaluated, not ignored during recovery.

If the retained provider no longer qualifies, Gozar must settle its owned
cleanup before selecting another eligible provider; unresolved debt blocks
replacement. Selection prefers an already usable lasting route, then an
eligible anonymous session, using provider data rather than branches in the
host. Unknown prerequisites do not count as eligible.

A stopped run never restarts itself, even after a late proof or process restart.
A later explicit `forward` call requests a new run and may reuse unchanged
approved disclosure; stopping the old run does not itself revoke that saved
approval. Changed or revoked approval still requires a fresh decision. The
host decides whether to request a run at app startup; Gozar does not turn an
app's saved Off setting back on.

The first change subscription must receive a persisted startup origin change
and every verified origin change since `forward` returned, then future changes
in order. The subscription gap cannot lose an event. The example subscribes
before its initial address publication; Gozar owns the replay buffer.
Its `at` records when the new verified origin was observed, not an invented
time during offline operation. The app signs/distributes its address records;
Gozar does neither. A verified recovery emits `back` and clears the current
`downSince` while preserving the outage observation for that event.

Assessment: 2026-11-26. The first consumer is an application exposing an existing
loopback HTTP listener to public HTTPS clients. The application owns its listener;
Gozar owns reachability, provider selection and the route lifecycle.

## The same task without `forward`

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
storage and approval UI, not provider branches. The `forward` contract
above is implemented in the package source and exercised by the installed-package
tests. Neither a release nor acceptance against a live provider is claimed.

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
