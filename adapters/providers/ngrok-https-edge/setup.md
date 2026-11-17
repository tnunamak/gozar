# ngrok HTTPS setup

Open **Set up an ngrok HTTPS listener** from the provider’s setup
prerequisites. If needed, approve installation of the optional, pinned
`@ngrok/ngrok@1.7.0` SDK. The host must be able to load the native module after
installation. Sign in to the intended account, open **Your Authtoken** and
paste the agent authtoken into Gozar’s private input. Gozar binds that secret
to the connector through the host’s secret backend. [ngrok setup](https://ngrok.com/docs/start)

Copy your assigned development or eligible reserved hostname from
**Domains**, or choose **Read the account inventory with an API key**.
The inventory option uses a separate management API key and reads
`GET https://api.ngrok.com/reserved_domains`. The agent receives the
authtoken alone. If the inventory option is unavailable, clear **Domain
source** in the draft and choose the dashboard instead. Verify that the
agent credential and domain belong to the same account. An approved
listener start checks that pairing and the account entitlement. The public
route verifier checks the actual HTTPS origin and app challenge.
[Reserved Domains API](https://ngrok.com/docs/api-reference/reserveddomains/list)

**Account verification.** In a test account, open **Domains** and record
the assigned hostname. If the account administrator provides a dedicated
inventory API key, enter it in the inventory action and verify the hostname
choice matches. Use **Your Authtoken** for the private agent input, approve
a test listener, and verify the actual app challenge from an independent
public client. Close the route and verify the exact endpoint is offline in
**Endpoints** while the assigned domain and any foreign listener remain.
Revoke a dedicated test key under **API Keys**, and revoke a dedicated test
authtoken under **Authtokens**, if one was issued for this test.

**Browser grant verification.** If an ngrok MCP client is already authorized
by the account owner, inspect its authenticated `tools/list` for a credential
create tool and its output schema without calling a mutation. The public
scope `credentials:write` does not establish minting or one-time secret
delivery. If a temporary test MCP grant was created for this inspection,
revoke that connection in ngrok afterward. Gozar uses assisted agent
credential intake today. [ngrok MCP guide](https://ngrok.com/docs/mcp-server)
