# Opt-in provider walk with stored credentials

This walk is for the operator. Fixture tests do not establish real provider
acceptance, account entitlement or public reachability. Do not paste tokens into
agent messages. Gozar collects secret terminal input without echo and stores it
privately. No environment token is used.

Install the optional SDK yourself when selecting its adapters:

```sh
npm install @tnunamak/gozar@0.4.0 @ngrok/ngrok@1.7.0
```

For a named connector, install the official `cloudflared` executable instead.
For the TLS stream proof, OpenSSL must be on PATH. Gozar reports missing local
prerequisites as data and never runs an installer.

## Prepare a query

Start your app on port 18765. Save this as `query.json`, replacing home with a
private absolute state-directory path. Select a provider with `--provider-id`
in the commands below; `gozar catalog --query-file query.json --json` lists ids.

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

For passthrough use transport `tcp` or `tls` and an application that speaks that
protocol. Stream proof establishes initial transport to Gozar's forwarding
boundary; it does not establish application identity or login. The TLS proof
certificate is synthetic and does not certify your application's certificate.

## Collect the input requirements

```sh
gozar configure --query-file query.json --provider-id ID --json
```

This command displays the selected choice's consent facts and each descriptor's
label, help and obtain URL. It prompts for credentials and plain values, stores
them, then returns setup state. It creates no route. A missing SDK or executable
can leave setup pending after inputs have been saved. Repeating configure edits
or rotates saved inputs; it does not reconfigure an existing live route.

For the HTTPS edge and passthrough adapters, obtain the **agent authtoken**, not
an API key, from [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken).
Use [Domains](https://dashboard.ngrok.com/domains) for the reserved domain when
the descriptor requests one. Supply the narrowest agent credential permitted by
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
Save only its candidateToken and disclosure.revision as a private approval file
with shape `{ "candidateToken": "...", "disclosureRevision": "..." }` and mode
0600. This file contains consent bearer data, never a provider credential.

```sh
gozar catalog --query-file query.json --provider-id ID --json
gozar expose --query-file query.json --provider-id ID --approval-file approval.json --wait verified --json
```

The attached CLI stays open while stdin holds its lease. Success returns a route
with routeState verified, a non-null published endpoint, actual proof time,
vantage and check results. Keep expiry and proof scope visible. For streams,
ordinary status does not repeat disruptive initial proof or stamp it fresh.
Open the returned endpoint from the intended client and check your app's own
authorization and successful request independently.

## Cleanup and ownership

Close stdin on the attached CLI to end the lease. Check that cleanup is confirmed;
unconfirmed means a runtime may remain and needs reconciliation. Gozar closes
only the connector/listener and gate it owns. Verify the app's original listener
still works and the public forwarding path has stopped.

For a named connector, stopping Gozar does **not** delete the remotely managed
tunnel, DNS record or token. Remove the unused tunnel and DNS route in the
dashboard when appropriate, and revoke/rotate the connector token there. Avoid
deleting a tunnel or DNS record used by another connector. For the SDK adapters,
reserved domains and agent credentials remain account-owned; remove or revoke
them separately if no longer needed.

The parent release walk records the actual operator steps and results. No real
provider exposure, account test, token request or cleanup was performed while
authoring this document.
