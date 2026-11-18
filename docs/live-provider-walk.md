# Opt-in provider walk with stored credentials

This walk is for the operator. Fixture tests do not establish real provider
acceptance, account entitlement or public reachability. Do not paste tokens into
agent messages. Gozar collects secret terminal input without echo and stores it
privately. This CLI walk uses the default private file backend; an embedding host
with a custom secret backend owns its separate storage, access and deletion policy.
Deleting local CLI state does not delete a host backend's credentials or revoke
provider credentials. No environment token is used. These are operator instructions,
not authorization for an agent to perform live actions.

Use Node >=22.13. Install locally in your walk directory; run the local binary
below, not a potentially different global installation:

```sh
npm install @tnunamak/gozar@0.5.0
```

Only for an SDK adapter, also install its optional dependency:

```sh
npm install @ngrok/ngrok@1.7.0
```

For a named connector, install the official `cloudflared` executable instead of
the optional SDK.
Public raw TCP/TLS profiles are detect-only in 0.4.0; this walk exercises HTTP(S).
Gozar reports missing local
prerequisites as data and never runs an installer.

## Prepare a query

Start your independent app on port 18765 with an operator-chosen safe HTTP probe
path that returns 200 and identifies this app. Record a local 200 control before
exposure, and keep the app running throughout connector and dashboard cleanup.
Save this as `query.json`, replacing home with a
private absolute state-directory path. Select a provider with `--provider-id`
in the commands below; `./node_modules/.bin/gozar catalog --query-file query.json --json` lists ids.

```json
{
  "schemaVersion": 1,
  "owner": "operator-walk",
  "home": "/absolute/private/gozar-walk",
  "target": "127.0.0.1:18765",
  "usage": { "kind": "attached" },
  "requirements": {
    "reach": "internet", "transport": "https",
    "payloadAccess": "allow-provider", "address": "any",
    "setup": "allow", "protocols": []
  }
}
```


## Collect the input requirements

```sh
./node_modules/.bin/gozar configure --query-file query.json --provider-id ID --json
```

This command displays the selected choice's consent facts and each descriptor's
label, help and obtain URL. It prompts for credentials and plain values, stores
them, then returns setup state. It creates no route. A missing SDK or executable
can leave setup pending after inputs have been saved. Repeating configure edits
or rotates saved inputs; it does not reconfigure an existing live route.

For the HTTPS edge adapter, obtain the **agent authtoken**, not
an API key, from [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken).
Use the assigned free development domain from [Domains](https://dashboard.ngrok.com/domains), or an address your plan permits. A paid custom reserved domain is not required for free HTTPS. Supply the narrowest agent credential permitted by
your account's endpoint policy. Gozar does not inspect its effective grants or
entitlement; those remain unknown until the provider accepts the request.

For the named connector, use the tunnel-specific connector token from
[Zero Trust](https://one.dash.cloudflare.com/), Networks → Connectors →
Cloudflare Tunnels → your tunnel → configure/install connector. This is a run
token for an existing remotely managed tunnel, not a broad account API token.
Create/own the tunnel and its DNS route in the dashboard. Choose a local connector
port distinct from the app port, for example 18479. Set the dashboard service
target to `http://127.0.0.1:18479`, then supply 18479 and the published HTTPS origin
through Gozar's descriptors. Remote dashboard configuration overrides a local
origin assumption; Gozar publishes nothing unless its gate proof passes.
See [tunnel-token handling](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/).

## Approve and start

Ask the catalog again after setup. Review the selected choice's full disclosure
and every affectsConsent fact, the exact local target and allocated origin.
Save its current route approval as a private file with shape `{ "kind": "route", "candidateToken": "...", "disclosureRevision": "...", "consentFactsDigest": "consent-v1:..." }` and mode
0600. This file contains consent bearer data, never a provider credential.

```sh
./node_modules/.bin/gozar catalog --query-file query.json --provider-id ID --json
./node_modules/.bin/gozar expose --query-file query.json --provider-id ID --approval-file approval.json --wait verified --json
```

The attached CLI stays open while stdin holds its lease. Success returns a route
with routeState verified, a non-null published endpoint, actual proof time,
vantage, bound subject and check results. Keep expiry and proof scope visible.
Open the returned endpoint from the intended client and check your app's own
authorization and successful request independently.

## Cleanup and ownership

Keep the saved public origin and a private `handle.json` containing the exact
returned route handle (including its generation), wrapped as
`{ "home": "/absolute/private/gozar-walk", "handle": <returned handle> }`.
Copy the handle object, not the whole expose envelope; do not fabricate an id or
generation. Keep this control file private. In a second terminal, the route-contract
commands are:

```sh
./node_modules/.bin/gozar routes --home /absolute/private/gozar-walk --owner operator-walk --json
./node_modules/.bin/gozar route-status --handle-file handle.json --json
./node_modules/.bin/gozar close --handle-file handle.json --json
```

`routes` takes home/owner, not a query file. Use `route-status` and `close`
with the handle file for this flow, not the legacy port-based `status`/`stop`
commands. `close` returns exit 0 only for confirmed cleanup; retain its actual
cleanup state and any error. Closing stdin on the attached expose CLI also ends
its lease, but that process exiting successfully alone is not cleanup evidence.
If status/close cannot establish cleanup, retain unknown/unconfirmed and reconcile;
`route_not_found` is not proof of remote absence.

Perform cleanup in this order:

1. Close only this walk's owned route/connector and gate, retaining its exact
   handle and generation. Check cleanup state. Leave the independent app running.
   Re-probe the saved public origin from the intended client and record the
   response alongside a contemporaneous local 200 from the same app probe path.
2. In the provider dashboard, identify the exact tunnel, hostname/domain, DNS
   route and credential belonging to this walk. Record which are exclusively
   owned, shared, or foreign before changing anything. Remove unused owned
   resources and revoke/rotate the applicable credential when appropriate.
   Never delete shared/foreign resources to make a test pass; document retained
   resources and unresolved cleanup instead.
3. **After those dashboard changes**, re-probe the saved public origin from the
   intended client again. Confirm that it no longer reaches this app, with a
   simultaneous local 200 control proving the independent app is still serving.
   Record UTC times, vantage, local/public responses (or transport errors) and
   the dashboard's observed state. If the local control fails, the negative
   public test is inconclusive. If the public origin still reaches the app,
   cleanup fails: investigate ownership and remaining connectors, not the app.
4. Only after this paired post-dashboard check passes may you stop the app and
   delete this walk's local state. Preserve redacted evidence first. If the
   check is not run or remains unknown, do not label the walk cleaned up.

For a named connector, stopping Gozar does **not** delete the remotely managed
tunnel, DNS record or token. Its tunnel-specific run token is not a broad account
API key. Dashboard cleanup and credential revocation are separate operations.
For SDK adapters, reserved domains and agent credentials remain account-owned;
remove or revoke only those no longer needed and owned by this walk.

Process stop, token rotation alone, DNS failure, `route_not_found`, or a provider
HTTP error alone cannot prove remote credential revocation or resource absence.
A passing paired probe demonstrates only that this saved origin did not reach
the still-live app at that time and vantage. Record credential revocation and
resource absence separately from dashboard evidence; retain unknown where the
dashboard does not establish them. Local file deletion is not remote revocation.

## Operator evidence and signoff

Record provider, actual account plan, platform/architecture, Node version and
installed package version (0.4.0 for this walk), plus optional SDK version if used.
Use a sanitized record for **each** step: install/prerequisites, local control,
configure, catalog/approval, expose/proof, intended-client positive request,
owned close/status, dashboard changes, paired post-dashboard probes, and final
app/state cleanup.

| Field | Operator entry |
| --- | --- |
| Step / operator / UTC time | not-run until performed |
| Command or dashboard action | exact command without bearer values; dashboard action label |
| Exit code | actual code, or n/a for dashboard; unknown if unavailable |
| Observation | actual result, not an expected result |
| Verdict / signoff | pass, fail, or not-run; operator and UTC |
| Route identity | exact handle id/kind and generation; provider and owner |
| Proof | observed proof time, expiry, scope/vantage, checks; unknown if absent |
| Cleanup | actual cleanup state; owned/shared/foreign resources retained |
| Responses | local status/app marker and public status/app marker or error, times and vantage |
| Dashboard | tunnel/hostname/DNS state and credential revocation evidence, or unknown |

Do not copy credentials, candidate tokens, approval tokens, auth-file contents or
unredacted catalog/approval output into evidence. Record only non-secret approval
metadata and that approval was supplied; keep bearer files private and separate.
Do not put bearer values in commands, URLs, screenshots or logs. Use the app's
normal private authentication without logging its values. A command's exit code
is not a substitute for the observed response and cleanup state.

No real provider exposure, account test, token request, probe or cleanup was
performed while authoring this document. Every live result remains not-run until
an operator supplies evidence; do not infer acceptance from fixture tests.
